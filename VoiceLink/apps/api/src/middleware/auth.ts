import type { Request, Response, NextFunction } from "express";

import { verifyAuthToken } from "../lib/jwt.js";

export interface AuthedUser {
  id: string;
  tenantId: string | null;
  role: string;
  isSuperadmin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? "";
  const match = header.match(/^Bearer (.+)$/i);
  if (!match) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }
  try {
    const claims = verifyAuthToken(match[1]);
    req.user = {
      id: claims.sub,
      tenantId: claims.tenantId,
      role: claims.role,
      isSuperadmin: claims.isSuperadmin,
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
