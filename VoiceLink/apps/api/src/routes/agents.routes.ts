import { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";

import {
  Agent,
  CreateAgentInput,
  UpdateAgentInput,
} from "@voiceplatform/shared";

import { getDb } from "../db/connection.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTenant, tenantScope } from "../middleware/tenant.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("agents");
export const agentsRouter = Router();

agentsRouter.use(requireAuth, requireTenant);

agentsRouter.get("/", async (req: Request, res: Response) => {
  const list = await getDb()
    .collection<Agent>("agents")
    .find(tenantScope(req))
    .sort({ updatedAt: -1 })
    .toArray();
  res.json({ agents: list });
});

agentsRouter.get("/:id", async (req: Request, res: Response) => {
  const agent = await getDb()
    .collection<Agent>("agents")
    .findOne(tenantScope(req, { _id: req.params.id }));
  if (!agent) {
    res.status(404).end();
    return;
  }
  res.json(agent);
});

agentsRouter.post("/", async (req: Request, res: Response) => {
  const parsed = CreateAgentInput.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const now = new Date();
  const id = new ObjectId().toString();
  const agent: Agent = {
    _id: id,
    tenantId: req.tenantId!,
    name: parsed.data.name,
    prompt: parsed.data.prompt ?? "",
    flowId: parsed.data.flowId,
    voice: parsed.data.voice,
    llm: parsed.data.llm,
    tools: parsed.data.tools ?? [],
    knowledgeBase: parsed.data.knowledgeBase,
    greeting: parsed.data.greeting ?? "",
    endCallTriggers: parsed.data.endCallTriggers ?? [],
    status: parsed.data.status ?? "draft",
    createdAt: now,
    updatedAt: now,
  };
  await getDb().collection<Agent>("agents").insertOne(agent);
  log.info({ agentId: id, tenantId: req.tenantId }, "agent created");
  res.status(201).json(agent);
});

agentsRouter.put("/:id", async (req: Request, res: Response) => {
  const parsed = UpdateAgentInput.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  // Drop tenantId/createdAt/_id from any incoming patch — caller can't
  // re-tenant an agent or rewrite history.
  const patch = { ...parsed.data, updatedAt: new Date() };
  const result = await getDb()
    .collection<Agent>("agents")
    .findOneAndUpdate(
      tenantScope(req, { _id: req.params.id }),
      { $set: patch },
      { returnDocument: "after" },
    );
  if (!result) {
    res.status(404).end();
    return;
  }
  res.json(result);
});

agentsRouter.delete("/:id", async (req: Request, res: Response) => {
  // Refuse delete when active campaigns reference this agent — would
  // orphan their next dial. Caller pauses + reassigns first.
  const inUse = await getDb()
    .collection("campaigns")
    .countDocuments(tenantScope(req, { agentId: req.params.id, status: { $in: ["running", "paused"] } }));
  if (inUse > 0) {
    res.status(409).json({
      error: "agent is referenced by an active campaign",
      campaigns: inUse,
    });
    return;
  }
  const result = await getDb()
    .collection<Agent>("agents")
    .deleteOne(tenantScope(req, { _id: req.params.id }));
  if (result.deletedCount === 0) {
    res.status(404).end();
    return;
  }
  res.status(204).end();
});
