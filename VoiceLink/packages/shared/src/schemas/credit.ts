import { z } from "zod";

export const CreditUnit = z.enum(["minutes", "units"]);
export const LedgerType = z.enum(["topup", "call", "refund", "adjustment"]);

export const Credits = z.object({
  _id: z.string(),
  tenantId: z.string(),
  balance: z.number().default(0),
  unit: CreditUnit.default("minutes"),
  // v2 — currency conversion is deferred per Architecture §7 + Q5
  currency: z.enum(["INR", "USD"]).optional(),
  updatedAt: z.coerce.date(),
});

export const CreditsLedgerEntry = z.object({
  _id: z.string(),
  tenantId: z.string(),
  callId: z.string().optional(),
  type: LedgerType,
  amount: z.number(),
  balanceAfter: z.number(),
  note: z.string().optional(),
  createdAt: z.coerce.date(),
});

export type CreditUnit = z.infer<typeof CreditUnit>;
export type LedgerType = z.infer<typeof LedgerType>;
export type Credits = z.infer<typeof Credits>;
export type CreditsLedgerEntry = z.infer<typeof CreditsLedgerEntry>;
