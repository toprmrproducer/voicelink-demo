"use server";

import { redirect } from "next/navigation";

import { LoginInput, type AuthToken } from "@voiceplatform/shared";

import { api, ApiError } from "@/lib/api";
import { setSession } from "@/lib/session";

export interface LoginState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = LoginInput.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    const res = await api.post<AuthToken>("/auth/login", parsed.data);
    await setSession(res.token);
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    return { error: "Login failed. Try again." };
  }
  redirect("/");
}
