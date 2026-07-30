"use server";

import { redirect } from "next/navigation";

import { SignupInput, type AuthToken } from "@voiceplatform/shared";

import { api, ApiError } from "@/lib/api";
import { setSession } from "@/lib/session";

export interface SignupState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

export async function signupAction(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const parsed = SignupInput.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    const res = await api.post<AuthToken>("/auth/signup", parsed.data);
    await setSession(res.token);
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    return { error: "Signup failed. Try again." };
  }
  redirect("/");
}
