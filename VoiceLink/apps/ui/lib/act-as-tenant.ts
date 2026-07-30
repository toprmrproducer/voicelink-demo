"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ACT_AS_TENANT_COOKIE } from "./api";

const ACT_AS_MAX_AGE = 60 * 60 * 24; // 24h — short by design; SAs rotate often

/**
 * Set the sticky "act as tenant" cookie for the current SA session.
 * After this, every server-side api call will auto-attach
 * `?tenantId=<id>` so the SA can browse the tenant-facing UI without
 * threading the param through every URL.
 *
 * Called from the admin tenants list ("Open this tenant" action).
 */
export async function pickTenant(tenantId: string, redirectTo: string = "/dashboard"): Promise<void> {
  const jar = await cookies();
  jar.set(ACT_AS_TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ACT_AS_MAX_AGE,
    path: "/",
  });
  redirect(redirectTo);
}

/**
 * Clear the sticky tenant override. SA returns to "no tenant context"
 * and can use admin/* routes again.
 */
export async function clearTenant(redirectTo: string = "/admin/tenants"): Promise<void> {
  const jar = await cookies();
  jar.delete(ACT_AS_TENANT_COOKIE);
  redirect(redirectTo);
}

/** Read the currently-acting tenant id (server-side, sync via cookies()). */
export async function getActingTenantId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(ACT_AS_TENANT_COOKIE)?.value ?? null;
}
