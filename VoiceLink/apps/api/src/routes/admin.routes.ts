import { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";

import {
  AssignDidInput,
  CreateTenantInput,
  type Did,
  type Tenant,
} from "@voiceplatform/shared";

import { getDb } from "../db/connection.js";
import { requireAuth } from "../middleware/auth.js";
import { requireSuperadmin } from "../middleware/superadmin.js";
import { createLogger } from "../lib/logger.js";
import { createVoicelinkProvider } from "../adapters/telephony/voicelink/index.js";
import type { TelephonyProvider } from "../adapters/telephony/types.js";
import { topUp, getLedgerPage } from "../credits/ledger.js";
import { TopUpInputSchema } from "./credits.routes.js";

const log = createLogger("admin");
export const adminRouter = Router();

/**
 * Best-effort: register a WS bot with the telephony provider so the
 * provider knows where to stream audio when calls land on this DID.
 * Failure here doesn't fail the DID assign — admin can retry by
 * re-running /admin/dids/assign, and outbound calls work without the
 * bot (they pass websocketUrl per call). Returns the providerBotId on
 * success, undefined on failure.
 */
async function registerDidBotBestEffort(
  did: Did,
  tenant: Tenant,
): Promise<string | undefined> {
  const wsBase = process.env.WS_BASE_URL;
  if (!wsBase) {
    log.warn({ didId: did._id }, "WS_BASE_URL unset — skipping bot registration");
    return undefined;
  }
  let provider: TelephonyProvider;
  try {
    provider = createVoicelinkProvider();
  } catch (err) {
    log.warn({ err, didId: did._id }, "telephony provider init failed — skipping bot reg");
    return undefined;
  }
  try {
    const handle = await provider.registerWebSocketBot({
      name: `did-${did.providerNumber}`,
      websocketUrl: `${wsBase}/ws/voicelink/${did._id}`,
      providerClientId: String(tenant.telephony.providerClientId),
      active: true,
    });
    return handle.providerBotId;
  } catch (err) {
    log.warn(
      { err, didId: did._id, tenantId: did.tenantId },
      "registerWebSocketBot failed — re-run dids/assign to retry",
    );
    return undefined;
  }
}

adminRouter.use(requireAuth, requireSuperadmin);

adminRouter.get("/tenants", async (_req: Request, res: Response) => {
  const tenants = await getDb()
    .collection<Tenant>("tenants")
    .find({}, { projection: { byok: 0 } })
    .toArray();
  res.json({ tenants: tenants.map((t) => ({ ...t, _id: String(t._id) })) });
});

adminRouter.post("/tenants/link", async (req: Request, res: Response) => {
  const parsed = CreateTenantInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const { name, voicelinkClientId } = parsed.data;
  const tenants = getDb().collection<Tenant>("tenants");

  const existing = await tenants.findOne({
    "telephony.providerClientId": voicelinkClientId,
  });
  if (existing) {
    res.status(409).json({
      error: "voicelinkClientId already linked",
      tenantId: String(existing._id),
    });
    return;
  }

  const now = new Date();
  const id = new ObjectId().toString();
  const tenant: Tenant = {
    _id: id,
    name,
    plan: "starter",
    status: "active",
    telephony: {
      provider: "voicelink",
      providerClientId: voicelinkClientId,
      walletThresholdNotify: 0,
    },
    createdAt: now,
    updatedAt: now,
  };
  await tenants.insertOne(tenant);
  log.info({ tenantId: id, voicelinkClientId }, "tenant linked");
  res.status(201).json(tenant);
});

// ───────────────────────── DIDs ─────────────────────────

adminRouter.get("/dids", async (req: Request, res: Response) => {
  const tenantId =
    typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
  const provider =
    typeof req.query.provider === "string" ? req.query.provider : undefined;
  const filter: Record<string, string> = {};
  if (tenantId) filter.tenantId = tenantId;
  if (provider) filter.provider = provider;

  const dids = await getDb()
    .collection<Did>("dids")
    .find(filter)
    .sort({ assignedAt: -1 })
    .toArray();
  res.json({
    dids: dids.map((d) => ({ ...d, _id: String(d._id) })),
  });
});

adminRouter.post("/dids/assign", async (req: Request, res: Response) => {
  const parsed = AssignDidInput.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const {
    tenantId,
    provider,
    providerNumber,
    didType,
    defaultAgentId,
  } = parsed.data;

  const db = getDb();

  // 1. Verify target tenant exists.
  const tenant = await db
    .collection<Tenant>("tenants")
    .findOne({ _id: tenantId });
  if (!tenant) {
    res.status(404).json({ error: "tenant not found" });
    return;
  }

  // 2. Look up an existing assignment for this number (across all tenants).
  const dids = db.collection<Did>("dids");
  const existing = await dids.findOne({ providerNumber });
  const now = new Date();

  if (existing) {
    if (existing.tenantId !== tenantId) {
      res.status(409).json({
        error: "DID already linked to another tenant",
        tenantId: existing.tenantId,
      });
      return;
    }
    // Idempotent same-tenant re-assign: update mutable fields + log.
    const patch: Partial<Did> = { updatedAt: now };
    if (didType !== undefined) patch.didType = didType;
    if (defaultAgentId !== undefined) patch.defaultAgentId = defaultAgentId;
    // Re-register the bot only if it's missing — re-assign without
    // providerBotId means the original registration failed.
    if (!existing.providerBotId) {
      const botId = await registerDidBotBestEffort(existing, tenant);
      if (botId) patch.providerBotId = botId;
    }
    await dids.updateOne({ _id: existing._id }, { $set: patch });
    await db.collection("did_logs").insertOne({
      providerNumber,
      tenantId,
      action: "reassign",
      at: now,
    });
    const after = await dids.findOne({ _id: existing._id });
    await backfillPendingCalls(providerNumber, tenantId, defaultAgentId);
    res.status(200).json({
      did: after ? { ...after, _id: String(after._id) } : null,
    });
    return;
  }

  // 3. Net-new DID assignment.
  const newDid: Did = {
    _id: new ObjectId().toString(),
    tenantId,
    provider,
    providerNumber,
    didType: didType ?? "unknown",
    status: "active",
    assignedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  if (defaultAgentId !== undefined) newDid.defaultAgentId = defaultAgentId;
  // Register the bot up-front so inbound calls land with the right
  // WS URL configured on the provider side. Failure is logged + the
  // DID is still saved without providerBotId; admin retries by
  // re-running this endpoint.
  const botId = await registerDidBotBestEffort(newDid, tenant);
  if (botId) newDid.providerBotId = botId;
  await dids.insertOne(newDid);
  await db.collection("did_logs").insertOne({
    providerNumber,
    tenantId,
    action: "assign",
    at: now,
  });
  const backfilled = await backfillPendingCalls(
    providerNumber,
    tenantId,
    defaultAgentId,
  );
  log.info(
    { tenantId, providerNumber, provider, backfilled },
    "DID assigned",
  );
  res
    .status(201)
    .json({ did: { ...newDid, _id: String(newDid._id) }, backfilled });
});

/**
 * Update any pre-existing "pending" call rows whose virtual_number matches
 * this DID. tenantId is always set; agentId is updated ONLY when a default
 * was supplied (otherwise pending until the call has explicit agent context).
 */
// --- Credits (superadmin) ---

/**
 * POST /admin/credits/topup — add credits to a tenant. Body matches
 * TopUpInputSchema (tenantId required, amount positive int).
 */
adminRouter.post("/credits/topup", async (req: Request, res: Response) => {
  const parsed = TopUpInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const tenant = await getDb()
    .collection<Tenant>("tenants")
    .findOne({ _id: parsed.data.tenantId });
  if (!tenant) {
    res.status(404).json({ error: "tenant not found" });
    return;
  }
  const result = await topUp(parsed.data);
  log.info(
    {
      tenantId: parsed.data.tenantId,
      amount: parsed.data.amount,
      type: parsed.data.type,
      balanceAfter: result.balanceAfter,
    },
    "admin credits topup",
  );
  res.status(201).json({
    tenantId: parsed.data.tenantId,
    balance: result.balanceAfter,
    ledgerId: result.ledgerId,
  });
});

/** GET /admin/credits/:tenantId — balance + last 50 ledger entries. */
adminRouter.get("/credits/:tenantId", async (req: Request, res: Response) => {
  const tenant = await getDb()
    .collection<Tenant>("tenants")
    .findOne({ _id: req.params.tenantId });
  if (!tenant) {
    res.status(404).json({ error: "tenant not found" });
    return;
  }
  const page = await getLedgerPage(req.params.tenantId, 50);
  res.json(page);
});

async function backfillPendingCalls(
  providerNumber: string,
  tenantId: string,
  defaultAgentId: string | undefined,
): Promise<number> {
  const calls = getDb().collection("calls");
  const set: Record<string, unknown> = { tenantId, updatedAt: new Date() };
  if (defaultAgentId !== undefined) set.agentId = defaultAgentId;
  const result = await calls.updateMany(
    {
      tenantId: "pending",
      $or: [
        { fromNumber: providerNumber },
        { toNumber: providerNumber },
      ],
    },
    { $set: set },
  );
  return result.modifiedCount;
}
