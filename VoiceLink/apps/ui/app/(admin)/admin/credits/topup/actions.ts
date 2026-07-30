"use server";

import { z } from "zod";

import { api, ApiError } from "@/lib/api";

const TopupForm = z.object({
  tenantId: z.string().min(1),
  amount: z.coerce.number().int().positive(),
  type: z.enum(["topup", "refund", "adjustment"]).default("topup"),
  note: z.string().max(280).optional(),
});

export interface TopupState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  success?: { tenantId: string; balance: number };
}

export async function topupAction(
  _prev: TopupState,
  formData: FormData,
): Promise<TopupState> {
  const note = String(formData.get("note") ?? "").trim();
  const parsed = TopupForm.safeParse({
    tenantId: String(formData.get("tenantId") ?? ""),
    amount: Number(formData.get("amount") ?? 0),
    type: String(formData.get("type") ?? "topup"),
    ...(note ? { note } : {}),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    const body = await api.post<{ tenantId: string; balance: number }>(
      "/admin/credits/topup",
      parsed.data,
    );
    return { success: body };
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    return { error: "Failed to top up." };
  }
}
