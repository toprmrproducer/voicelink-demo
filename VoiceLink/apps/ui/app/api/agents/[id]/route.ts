import { NextResponse } from "next/server";

import { api, ApiError } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(err.body ?? { error: err.message }, {
      status: err.status,
    });
  }
  throw err;
}

export async function GET(_req: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  try {
    return NextResponse.json(await api.get(`/agents/${id}`));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  try {
    const body = await req.json();
    return NextResponse.json(await api.put(`/agents/${id}`, body));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  try {
    await api.del(`/agents/${id}`);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
