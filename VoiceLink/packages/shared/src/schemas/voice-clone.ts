import { z } from "zod";

import { VoiceProvider } from "./agent.js";

export const VoiceClone = z.object({
  _id: z.string(),
  tenantId: z.string(),
  provider: VoiceProvider,
  providerVoiceId: z.string(),
  name: z.string().min(1).max(120),
  sampleUrl: z.string().url().optional(),
  isPublic: z.boolean().default(false),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CreateVoiceCloneInput = VoiceClone.omit({
  _id: true,
  tenantId: true,
  createdAt: true,
  updatedAt: true,
}).partial({ sampleUrl: true, isPublic: true });

export type VoiceClone = z.infer<typeof VoiceClone>;
export type CreateVoiceCloneInput = z.infer<typeof CreateVoiceCloneInput>;
