// Thin typed fetch wrapper for the platform API.
// Server Components and Server Actions both call through this so the
// session cookie is forwarded automatically. Client Components should
// hit Next route handlers under app/api/* (which proxy to here) rather
// than the API directly.

import { cookies } from "next/headers";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

const SESSION_COOKIE = "vp_session";
/**
 * Sticky tenant override for superadmins. When set, every authedFetch
 * call appends `?tenantId=<value>` so the SA acts as that tenant on
 * tenant-scoped routes without having to thread the param through
 * every page. Cookie is set by `pickTenant()` (server action) and
 * cleared by `clearTenant()`. Ignored entirely for non-SA users —
 * their token already carries their tenantId.
 */
const ACT_AS_TENANT_COOKIE = "vp_act_as_tenant";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Append `?tenantId=...` (or `&tenantId=...`) when we have an act-as cookie. */
function withTenant(path: string, tenantId: string | undefined): string {
  if (!tenantId) return path;
  // Already has ?tenantId=? Don't override.
  if (/[?&]tenantId=/.test(path)) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}tenantId=${encodeURIComponent(tenantId)}`;
}

async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const actAs = jar.get(ACT_AS_TENANT_COOKIE)?.value;
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(`${API_BASE}${withTenant(path, actAs)}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}

async function unwrap<T>(res: Response): Promise<T> {
  const text = await res.text();
  const json = text ? (JSON.parse(text) as T) : (undefined as T);
  if (!res.ok) {
    const message =
      (json as { error?: string } | undefined)?.error ??
      `API ${res.status} ${res.statusText}`;
    throw new ApiError(res.status, message, json);
  }
  return json;
}

export const api = {
  get: <T>(path: string) =>
    authedFetch(path, { method: "GET" }).then(unwrap<T>),

  post: <T>(path: string, body?: unknown) =>
    authedFetch(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(unwrap<T>),

  put: <T>(path: string, body?: unknown) =>
    authedFetch(path, {
      method: "PUT",
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(unwrap<T>),

  del: <T>(path: string) =>
    authedFetch(path, { method: "DELETE" }).then(unwrap<T>),
};

export { SESSION_COOKIE, ACT_AS_TENANT_COOKIE, API_BASE };
