import type { Request, Response, NextFunction } from "express";

export function requireSuperadmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }
  if (!req.user.isSuperadmin) {
    res.status(404).end();
    return;
  }
  next();
}
