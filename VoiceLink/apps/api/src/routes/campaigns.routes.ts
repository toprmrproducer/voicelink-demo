import { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";

import {
  Campaign,
  CreateCampaignInput,
  UpdateCampaignInput,
  type Did,
} from "@voiceplatform/shared";

import { getDb } from "../db/connection.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTenant, tenantScope } from "../middleware/tenant.js";
import { parseCSV, CSVImportError } from "../campaign-engine/csv-import.js";
import { enqueueNextDial } from "../campaign-engine/queue.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("campaigns");
export const campaignsRouter = Router();

campaignsRouter.use(requireAuth, requireTenant);

campaignsRouter.get("/", async (req: Request, res: Response) => {
  const list = await getDb()
    .collection<Campaign>("campaigns")
    .find(tenantScope(req))
    .sort({ createdAt: -1 })
    .toArray();
  res.json({ campaigns: list });
});

campaignsRouter.get("/:id", async (req: Request, res: Response) => {
  const campaign = await getDb()
    .collection<Campaign>("campaigns")
    .findOne(tenantScope(req, { _id: req.params.id }));
  if (!campaign) {
    res.status(404).end();
    return;
  }
  res.json(campaign);
});

campaignsRouter.post("/", async (req: Request, res: Response) => {
  const parsed = CreateCampaignInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const now = new Date();
  const id = new ObjectId().toString();
  const campaign: Campaign = {
    _id: id,
    tenantId: req.tenantId!,
    agentId: parsed.data.agentId,
    fromDid: parsed.data.fromDid,
    name: parsed.data.name,
    csvImportRef: parsed.data.csvImportRef,
    schedule: parsed.data.schedule,
    numbers: parsed.data.numbers ?? [],
    status: "draft",
    stats: { total: parsed.data.numbers?.length ?? 0, dialed: 0, connected: 0, succeeded: 0, failed: 0 },
    cursor: 0,
    createdAt: now,
    updatedAt: now,
  };
  await getDb().collection<Campaign>("campaigns").insertOne(campaign);
  res.status(201).json(campaign);
});

campaignsRouter.put("/:id", async (req: Request, res: Response) => {
  const parsed = UpdateCampaignInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  // Don't let callers move status via this route — start/pause endpoints
  // do that with the right side-effects.
  const { status: _status, ...patch } = parsed.data;
  const update = { ...patch, updatedAt: new Date() };
  const result = await getDb()
    .collection<Campaign>("campaigns")
    .findOneAndUpdate(
      tenantScope(req, { _id: req.params.id }),
      { $set: update },
      { returnDocument: "after" },
    );
  if (!result) {
    res.status(404).end();
    return;
  }
  res.json(result);
});

campaignsRouter.delete("/:id", async (req: Request, res: Response) => {
  const result = await getDb()
    .collection<Campaign>("campaigns")
    .deleteOne(tenantScope(req, { _id: req.params.id }));
  if (result.deletedCount === 0) {
    res.status(404).end();
    return;
  }
  res.status(204).end();
});

// ---------- CSV import ----------

const ImportBody = z.object({
  csvBase64: z.string().min(1),
  replace: z.boolean().default(false),
});

campaignsRouter.post("/:id/numbers/import", async (req: Request, res: Response) => {
  const parsed = ImportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const campaigns = getDb().collection<Campaign>("campaigns");
  const campaign = await campaigns.findOne(tenantScope(req, { _id: req.params.id }));
  if (!campaign) {
    res.status(404).end();
    return;
  }
  if (campaign.status === "running") {
    res.status(409).json({ error: "pause the campaign before importing more numbers" });
    return;
  }
  let result;
  try {
    result = parseCSV(Buffer.from(parsed.data.csvBase64, "base64").toString("utf8"));
  } catch (err) {
    if (err instanceof CSVImportError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
  const merged = parsed.data.replace
    ? result.numbers
    : [...campaign.numbers, ...result.numbers];
  await campaigns.updateOne(
    tenantScope(req, { _id: req.params.id }),
    {
      $set: {
        numbers: merged,
        "stats.total": merged.length,
        updatedAt: new Date(),
        // Reset cursor on full replace so the new list dials from the top.
        ...(parsed.data.replace ? { cursor: 0 } : {}),
      },
    },
  );
  res.json({
    imported: result.numbers.length,
    rejected: result.rejected,
    total: merged.length,
  });
});

// ---------- start / pause / resume ----------

async function loadOrThrow(req: Request, res: Response): Promise<Campaign | null> {
  const campaign = await getDb()
    .collection<Campaign>("campaigns")
    .findOne(tenantScope(req, { _id: req.params.id }));
  if (!campaign) {
    res.status(404).end();
    return null;
  }
  return campaign;
}

campaignsRouter.post("/:id/start", async (req: Request, res: Response) => {
  const campaign = await loadOrThrow(req, res);
  if (!campaign) return;

  if (!campaign.fromDid) {
    res.status(400).json({ error: "fromDid is required to start a campaign" });
    return;
  }
  // Verify the DID is owned by this tenant + active.
  const did = await getDb()
    .collection<Did>("dids")
    .findOne(tenantScope(req, { providerNumber: campaign.fromDid }));
  if (!did || did.status !== "active") {
    res.status(400).json({ error: "fromDid is not assigned + active for this tenant" });
    return;
  }
  if (campaign.numbers.length === 0) {
    res.status(400).json({ error: "campaign has no numbers to dial" });
    return;
  }
  if (campaign.status === "running") {
    res.json(campaign);
    return;
  }

  const updated = await getDb()
    .collection<Campaign>("campaigns")
    .findOneAndUpdate(
      tenantScope(req, { _id: req.params.id }),
      { $set: { status: "running", updatedAt: new Date() } },
      { returnDocument: "after" },
    );

  // Kick the queue. In dev mode (REDIS_URL unset) this is a no-op —
  // operator uses /:id/dial-now to advance a single lead manually.
  await enqueueNextDial(campaign._id, req.tenantId!);
  log.info({ campaignId: campaign._id }, "campaign started");
  res.json(updated);
});

campaignsRouter.post("/:id/pause", async (req: Request, res: Response) => {
  const result = await getDb()
    .collection<Campaign>("campaigns")
    .findOneAndUpdate(
      tenantScope(req, { _id: req.params.id, status: "running" }),
      { $set: { status: "paused", updatedAt: new Date() } },
      { returnDocument: "after" },
    );
  if (!result) {
    res.status(404).end();
    return;
  }
  res.json(result);
});

campaignsRouter.post("/:id/resume", async (req: Request, res: Response) => {
  const result = await getDb()
    .collection<Campaign>("campaigns")
    .findOneAndUpdate(
      tenantScope(req, { _id: req.params.id, status: "paused" }),
      { $set: { status: "running", updatedAt: new Date() } },
      { returnDocument: "after" },
    );
  if (!result) {
    res.status(404).end();
    return;
  }
  await enqueueNextDial(result._id, req.tenantId!);
  res.json(result);
});

/**
 * Dev / test helper — runs one dial inline, bypassing BullMQ. Useful
 * for the integration suite and for manual prod kicking when Redis is
 * down. Production flow uses the queued worker for pacing.
 */
campaignsRouter.post("/:id/dial-now", async (req: Request, res: Response) => {
  const campaign = await loadOrThrow(req, res);
  if (!campaign) return;
  if (campaign.status !== "running") {
    res.status(409).json({ error: "campaign is not running" });
    return;
  }
  const { dialNextLead } = await import("../campaign-engine/runner.js");
  const { createVoicelinkProvider } = await import(
    "../adapters/telephony/voicelink/index.js"
  );
  const result = await dialNextLead(req.params.id, req.tenantId!, {
    telephony: createVoicelinkProvider(),
    campaigns: getDb().collection<Campaign>("campaigns"),
    calls: getDb().collection("calls") as never,
    dids: getDb().collection("dids"),
    wsBaseUrl: process.env.WS_BASE_URL,
  });
  res.json({ status: result.status, callId: result.call?._id });
});
