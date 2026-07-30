import { NextResponse } from "next/server";

import { api, ApiError } from "@/lib/api";

export async function GET(): Promise<NextResponse> {
  try {
    const body = await api.get("/agents");
    return NextResponse.json(body);
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
    const created = await api.post("/agents", body);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(err.body ?? { error: err.message }, {
        status: err.status,
      });
    }
    throw err;
  }
}
