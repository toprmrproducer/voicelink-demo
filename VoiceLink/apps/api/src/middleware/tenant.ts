import type { Request, Response, NextFunction } from "express";

import type { Filter, Document } from "mongodb";

/**
 * Require the request to belong to a tenant. Stores the scoped tenantId
 * on `req.tenantId` for downstream handlers.
 *
 * Superadmin users MUST pass `?tenantId=<id>` to act on behalf of a
 * tenant when hitting a tenant-scoped route — without it we return 400.
 * (Previously we let SAs through with `req.tenantId = null` and let the
 * handler decide, which crashed `tenantScope()` with an unhandled throw.)
 *
 * Cross-tenant admin reads still work through the dedicated `/admin/*`
 * routes which use `requireSuperadmin` directly.
 */
export function requireTenant(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }

  if (req.user.isSuperadmin) {
    const override = req.query.tenantId;
    if (typeof override !== "string" || override.length === 0) {
      res.status(400).json({
        error:
          "Superadmin must pass ?tenantId=<id> on tenant-scoped routes. Use /admin/* for cross-tenant operations.",
      });
      return;
    }
    req.tenantId = override;
    next();
    return;
  }

  if (!req.user.tenantId) {
    // Non-superadmin user with no tenant is a corrupt token.
    res.status(404).end();
    return;
  }
  req.tenantId = req.user.tenantId;
  next();
}

/**
 * Returns a Mongo filter pre-scoped to the request's tenant. Use this on
 * every read/write to a tenant-scoped collection. Forgetting it is the
 * single biggest cross-tenant leak risk; the test suite asserts that
 * cross-tenant queries return 404.
 */
export function tenantScope<T extends Document>(
  req: Request,
  filter: Filter<T> = {},
): Filter<T> {
  if (!req.tenantId) {
    throw new Error("tenantScope() called without a tenant on the request");
  }
  return { ...filter, tenantId: req.tenantId } as Filter<T>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenantId?: string | null;
    }
  }
}
