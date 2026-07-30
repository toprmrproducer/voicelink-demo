import { NextResponse } from "next/server";

import { api, ApiError } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  try {
    return NextResponse.json(await api.post(`/campaigns/${id}/start`));
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(err.body ?? { error: err.message }, {
        status: err.status,
      });
    }
    throw err;
  }
}
