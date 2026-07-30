"use server";

import { redirect } from "next/navigation";

import { CreateTenantInput, type Tenant } from "@voiceplatform/shared";

import { api, ApiError } from "@/lib/api";

export interface LinkTenantState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

export async function linkTenantAction(
  _prev: LinkTenantState,
  formData: FormData,
): Promise<LinkTenantState> {
  const parsed = CreateTenantInput.safeParse({
    name: String(formData.get("name") ?? ""),
    voicelinkClientId: Number(formData.get("voicelinkClientId") ?? 0),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    await api.post<Tenant>("/admin/tenants/link", parsed.data);
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    return { error: "Failed to link tenant." };
  }
  redirect("/admin/tenants");
}
