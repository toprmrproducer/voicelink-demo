import { NextResponse } from "next/server";

import { api, ApiError } from "@/lib/api";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await api.get("/dids"));
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(err.body ?? { error: err.message }, {
        status: err.status,
      });
    }
    throw err;
  }
}
