import { NextResponse } from "next/server";

import { api, ApiError } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  try {
    await api.del(`/voice-clones/${id}`);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(err.body ?? { error: err.message }, {
        status: err.status,
      });
    }
    throw err;
  }
}
