import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { requireAuth } from "../middleware/auth.js";
import { requireTenant } from "../middleware/tenant.js";
import { getLedgerPage } from "../credits/ledger.js";

export const creditsRouter = Router();

creditsRouter.use(requireAuth, requireTenant);

/**
 * GET /credits[?limit=N] — tenant's running balance + last N ledger
 * entries (newest first). Default limit 50, cap 200.
 */
creditsRouter.get("/", async (req: Request, res: Response) => {
  const limit = Math.min(200, Number(req.query.limit ?? 50) || 50);
  const page = await getLedgerPage(req.tenantId!, limit);
  res.json(page);
});

/**
 * Schema used by /admin/credits/topup. Lives here so both routers can
 * share validation rules; the admin router imports it.
 */
export const TopUpInputSchema = z.object({
  tenantId: z.string().min(1),
  amount: z.number().int().positive(),
  type: z.enum(["topup", "refund", "adjustment"]).default("topup"),
  callId: z.string().optional(),
  note: z.string().max(280).optional(),
});
export type TopUpInputBody = z.infer<typeof TopUpInputSchema>;
