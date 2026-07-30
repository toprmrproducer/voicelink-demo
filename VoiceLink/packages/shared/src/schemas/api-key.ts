import { z } from "zod";

export const ApiKeyKind = z.enum([
  "mcp",
  "webhook",
  "byok-openai",
  "byok-gemini",
  "byok-elevenlabs",
  "byok-cartesia",
  "byok-playht",
]);

export const ApiKey = z.object({
  _id: z.string(),
  tenantId: z.string(),
  kind: ApiKeyKind,
  hash: z.string(),
  // For BYOK kinds, this is the AES-GCM ciphertext (base64). For mcp/webhook,
  // this is unused and we store only the hash of the plaintext secret.
  encrypted: z.string().optional(),
  label: z.string().optional(),
  lastUsedAt: z.coerce.date().optional(),
  createdAt: z.coerce.date(),
});

export type ApiKeyKind = z.infer<typeof ApiKeyKind>;
export type ApiKey = z.infer<typeof ApiKey>;
