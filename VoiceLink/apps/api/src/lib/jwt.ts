import jwt from "jsonwebtoken";

export interface AuthClaims {
  sub: string;          // user id
  tenantId: string | null;
  role: string;
  isSuperadmin: boolean;
}

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error("JWT_SECRET env var is required (>=16 chars)");
  }
  return s;
}

function expiresIn(): string {
  return process.env.JWT_EXPIRES_IN ?? "7d";
}

export function signAuthToken(claims: AuthClaims): string {
  return jwt.sign(claims, secret(), {
    expiresIn: expiresIn() as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAuthToken(token: string): AuthClaims {
  const decoded = jwt.verify(token, secret());
  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("Malformed token");
  }
  const d = decoded as Record<string, unknown>;
  if (typeof d.sub !== "string" || typeof d.role !== "string") {
    throw new Error("Malformed token claims");
  }
  return {
    sub: d.sub,
    tenantId: d.tenantId === null ? null : String(d.tenantId),
    role: d.role,
    isSuperadmin: Boolean(d.isSuperadmin),
  };
}
