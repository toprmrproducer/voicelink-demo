import { NextResponse } from "next/server";

import { api, ApiError } from "@/lib/api";

export async function POST(req: Request): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await api.post("/calls/dial", body), { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(err.body ?? { error: err.message }, { status: err.status });
    }
    throw err;
  }
}
