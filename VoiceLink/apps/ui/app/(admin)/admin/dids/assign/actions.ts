"use server";

import { redirect } from "next/navigation";

import { AssignDidInput } from "@voiceplatform/shared";

import { api, ApiError } from "@/lib/api";

export interface AssignDidState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

export async function assignDidAction(
  _prev: AssignDidState,
  formData: FormData,
): Promise<AssignDidState> {
  const defaultAgentId = String(formData.get("defaultAgentId") ?? "").trim();
  const parsed = AssignDidInput.safeParse({
    tenantId: String(formData.get("tenantId") ?? ""),
    providerNumber: String(formData.get("providerNumber") ?? ""),
    didType: String(formData.get("didType") ?? "unknown"),
    ...(defaultAgentId ? { defaultAgentId } : {}),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    await api.post("/admin/dids/assign", parsed.data);
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    return { error: "Failed to assign DID." };
  }
  redirect("/admin/dids");
}
