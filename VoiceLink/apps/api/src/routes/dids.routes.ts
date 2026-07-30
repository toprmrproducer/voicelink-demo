import { Router, type Request, type Response } from "express";

import type { Did } from "@voiceplatform/shared";

import { getDb } from "../db/connection.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTenant, tenantScope } from "../middleware/tenant.js";

/**
 * Tenant-scoped, read-only DID listing. Tenants need this to pick a
 * `fromDid` when creating a campaign. Superadmin DID assignment lives
 * under `/admin/dids` (admin.routes.ts) — this route never assigns or
 * mutates.
 */
export const didsRouter = Router();

didsRouter.use(requireAuth, requireTenant);

didsRouter.get("/", async (req: Request, res: Response) => {
  const dids = await getDb()
    .collection<Did>("dids")
    .find(tenantScope(req))
    .sort({ assignedAt: -1 })
    .toArray();
  res.json({
    dids: dids.map((d) => ({ ...d, _id: String(d._id) })),
  });
});
