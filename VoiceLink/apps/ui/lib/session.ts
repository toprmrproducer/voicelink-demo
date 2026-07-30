import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { PublicUser } from "@voiceplatform/shared";

import { api, ApiError, SESSION_COOKIE } from "./api";

const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days, matches JWT_EXPIRES_IN default

export async function setSession(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  // The api doesn't expose a /me endpoint yet; decode the JWT client-side
  // would be cheaper but we want server validation. Until /me lands,
  // attempt a lightweight authed call to /health and treat 401 as
  // "session expired".
  // TODO(post-S3.1): replace with `api.get<PublicUser>("/me")`.
  try {
    await api.get("/health");
    // Decode the JWT payload (already verified by /health round-trip).
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    ) as { sub: string; tenantId: string | null; role: string; isSuperadmin?: boolean };
    return {
      _id: payload.sub,
      tenantId: payload.tenantId,
      email: "",
      role: payload.role as PublicUser["role"],
      isSuperadmin: Boolean(payload.isSuperadmin),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSession();
    }
    return null;
  }
}

export async function requireUser(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireSuperadmin(): Promise<PublicUser> {
  const user = await requireUser();
  if (!user.isSuperadmin) redirect("/");
  return user;
}
