import { NextResponse } from "next/server";

import { api } from "@/lib/api";
import { clearSession } from "@/lib/session";

export async function POST(): Promise<NextResponse> {
  // Best-effort tell the api; ignore result either way.
  try {
    await api.post("/auth/logout");
  } catch {
    /* noop */
  }
  await clearSession();
  return NextResponse.json({ ok: true });
}
