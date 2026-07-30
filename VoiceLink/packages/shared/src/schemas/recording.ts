import { z } from "zod";

export const Recording = z.object({
  _id: z.string(),
  tenantId: z.string(),
  callId: z.string(),
  url: z.string().url(),
  durationSec: z.number().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  format: z.enum(["wav", "mp3", "mulaw"]).default("wav"),
  createdAt: z.coerce.date(),
});

export type Recording = z.infer<typeof Recording>;
