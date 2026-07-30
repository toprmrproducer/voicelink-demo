import { z } from "zod";

export const TranscriptTurn = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  text: z.string(),
  ts: z.coerce.date(),
  ms: z.number().nonnegative().optional(),
});

export const Transcript = z.object({
  _id: z.string(),
  tenantId: z.string(),
  callId: z.string(),
  turns: z.array(TranscriptTurn).default([]),
  summary: z.string().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type TranscriptTurn = z.infer<typeof TranscriptTurn>;
export type Transcript = z.infer<typeof Transcript>;
