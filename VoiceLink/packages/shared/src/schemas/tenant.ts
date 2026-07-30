import { z } from "zod";

export const TenantPlan = z.enum(["starter", "growth", "scale"]);
export const TenantStatus = z.enum(["active", "paused", "churned"]);
export const TelephonyProvider = z.enum(["voicelink", "fonada"]);

export const TenantTelephony = z.object({
  provider: TelephonyProvider,
  providerClientId: z.number().int().positive(),
  walletThresholdNotify: z.number().nonnegative().default(0),
});

export const TenantBYOK = z
  .object({
    openaiKey: z.string().optional(),
    geminiKey: z.string().optional(),
    elevenLabsKey: z.string().optional(),
    cartesiaKey: z.string().optional(),
    playhtUserId: z.string().optional(),
    playhtApiKey: z.string().optional(),
  })
  .strict()
  .partial();

export const Tenant = z.object({
  _id: z.string(),
  name: z.string().min(1).max(120),
  plan: TenantPlan.default("starter"),
  status: TenantStatus.default("active"),
  telephony: TenantTelephony,
  byok: TenantBYOK.optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CreateTenantInput = z.object({
  name: z.string().min(1).max(120),
  voicelinkClientId: z.number().int().positive(),
});

export type TenantPlan = z.infer<typeof TenantPlan>;
export type TenantStatus = z.infer<typeof TenantStatus>;
export type TelephonyProvider = z.infer<typeof TelephonyProvider>;
export type TenantTelephony = z.infer<typeof TenantTelephony>;
export type TenantBYOK = z.infer<typeof TenantBYOK>;
export type Tenant = z.infer<typeof Tenant>;
export type CreateTenantInput = z.infer<typeof CreateTenantInput>;
