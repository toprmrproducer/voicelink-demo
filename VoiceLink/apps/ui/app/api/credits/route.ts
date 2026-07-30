import { NextResponse } from "next/server";

import { api, ApiError } from "@/lib/api";

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  try {
    return NextResponse.json(await api.get(`/credits${url.search}`));
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(err.body ?? { error: err.message }, {
        status: err.status,
      });
    }
    throw err;
  }
}
