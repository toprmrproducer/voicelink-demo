import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { getDograhClient } from "../mcp/dograh-client.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTenant } from "../middleware/tenant.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("flows");
export const flowsRouter = Router();

flowsRouter.use(requireAuth, requireTenant);

// Helper — every route here needs the Dograh client. Returns 503 if not
// configured (DOGRAH_MCP_URL missing) so the rest of the api stays up
// independently of Dograh availability.
function client() {
  const c = getDograhClient();
  if (!c) {
    const err = new Error("Dograh MCP not configured");
    (err as Error & { status?: number }).status = 503;
    throw err;
  }
  return c;
}

flowsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const result = await client().listWorkflows();
    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
});

flowsRouter.get("/node-types", async (_req: Request, res: Response) => {
  try {
    const result = await client().listNodeTypes();
    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
});

flowsRouter.get("/:id/code", async (req: Request, res: Response) => {
  try {
    const result = await client().getWorkflowCode(req.params.id);
    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
});

const CreateFlowBody = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(1),
});

flowsRouter.post("/", async (req: Request, res: Response) => {
  const parsed = CreateFlowBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  try {
    const result = await client().createWorkflow(parsed.data);
    res.status(201).json(result);
  } catch (err) {
    handleErr(err, res);
  }
});

const SaveFlowBody = z.object({ code: z.string().min(1) });

flowsRouter.put("/:id", async (req: Request, res: Response) => {
  const parsed = SaveFlowBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  try {
    const result = await client().saveWorkflow({
      id: req.params.id,
      code: parsed.data.code,
    });
    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
});

function handleErr(err: unknown, res: Response): void {
  const status =
    (err as Error & { status?: number }).status ??
    (err instanceof Error && err.message.includes("not configured") ? 503 : 502);
  const message = err instanceof Error ? err.message : "Engine call failed";
  log.warn({ err }, "dograh mcp call failed");
  res.status(status).json({ error: message });
}
