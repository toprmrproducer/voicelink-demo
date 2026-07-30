import { Router, type Request, type Response } from "express";

import type { Call, Did } from "@voiceplatform/shared";

import { getDb } from "../db/connection.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTenant, tenantScope } from "../middleware/tenant.js";
import { createVoicelinkProvider } from "../adapters/telephony/voicelink/index.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("calls");

export const callsRouter = Router();

callsRouter.use(requireAuth, requireTenant);

/**
 * POST /calls/dial — place a single outbound call from the UI ("call me").
 * Body: { toNumber: string, didId?: string }.
 * Picks the tenant's active DID (or the given one), dials toNumber, and
 * connects the call to our WS bot so the agent talks. Indian numbers are
 * normalized to national + country_code inside the provider.
 */
callsRouter.post("/dial", async (req: Request, res: Response) => {
  const toNumber = String((req.body as { toNumber?: unknown })?.toNumber ?? "").trim();
  const didId = (req.body as { didId?: unknown })?.didId;
  if (!/^[0-9+]{6,15}$/.test(toNumber)) {
    res.status(400).json({ error: "toNumber must be 6-15 digits (with optional leading +)" });
    return;
  }

  const dids = getDb().collection<Did>("dids");
  const did = typeof didId === "string" && didId.length > 0
    ? await dids.findOne(tenantScope(req, { _id: didId }))
    : await dids.findOne(tenantScope(req, { status: "active" }));
  if (!did) {
    res.status(404).json({ error: "no active DID for this tenant" });
    return;
  }

  const wsBase = process.env.WS_BASE_URL;
  if (!wsBase) {
    res.status(503).json({ error: "WS_BASE_URL not configured (start the public tunnel)" });
    return;
  }
  const httpBase = wsBase.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  const websocketUrl = `${wsBase}/ws/voicelink/${did._id}`;
  const webhookUrl = `${httpBase}/webhooks/voicelink`;

  try {
    const provider = createVoicelinkProvider();
    const handle = await provider.originateCall({
      fromDid: did.providerNumber,
      toNumber,
      websocketUrl,
      webhookUrl,
    });
    log.info({ to: toNumber, did: did.providerNumber, providerCallId: handle.providerCallId }, "manual dial placed");
    res.status(201).json({ ok: true, providerCallId: handle.providerCallId, to: toNumber, from: did.providerNumber });
  } catch (err) {
    log.error({ err, to: toNumber }, "manual dial failed");
    res.status(502).json({ error: "dial failed at provider", detail: (err as Error).message });
  }
});

/**
 * GET /calls — paginated list of calls for the caller's tenant.
 *
 * Query params:
 *   - limit (default 50, max 200)
 *   - status (filter by Call.status)
 *   - direction ("in" | "out")
 *   - agentId
 *   - campaignId
 *   - before (ISO date) — return calls created strictly before this timestamp
 *
 * Newest first. Cursor pagination uses `before=<createdAt>` of the last
 * row in the previous page.
 */
callsRouter.get("/", async (req: Request, res: Response) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
  const filter: Record<string, unknown> = {};
  for (const key of ["status", "direction", "agentId", "campaignId"] as const) {
    const v = req.query[key];
    if (typeof v === "string" && v.length > 0) filter[key] = v;
  }
  const before = req.query.before;
  if (typeof before === "string") {
    const parsed = new Date(before);
    if (Number.isFinite(parsed.getTime())) {
      filter.createdAt = { $lt: parsed };
    }
  }

  const list = await getDb()
    .collection<Call>("calls")
    .find(tenantScope(req, filter))
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  res.json({ calls: list });
});

callsRouter.get("/:id", async (req: Request, res: Response) => {
  const call = await getDb()
    .collection<Call>("calls")
    .findOne(tenantScope(req, { _id: req.params.id }));
  if (!call) {
    res.status(404).end();
    return;
  }
  res.json(call);
});
