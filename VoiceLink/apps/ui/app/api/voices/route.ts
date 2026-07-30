import { NextResponse } from "next/server";

import { api, ApiError } from "@/lib/api";

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const qs = url.search; // includes leading "?" or ""
  try {
    return NextResponse.json(await api.get(`/voices${qs}`));
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(err.body ?? { error: err.message }, {
        status: err.status,
      });
    }
    throw err;
  }
}
