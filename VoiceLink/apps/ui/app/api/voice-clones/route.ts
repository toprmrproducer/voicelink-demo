import { NextResponse } from "next/server";

import { api, ApiError } from "@/lib/api";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await api.get("/voice-clones"));
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(err.body ?? { error: err.message }, {
        status: err.status,
      });
    }
    throw err;
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = await req.json();
    return NextResponse.json(await api.post("/voice-clones", body), {
      status: 201,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(err.body ?? { error: err.message }, {
        status: err.status,
      });
    }
    throw err;
  }
}
