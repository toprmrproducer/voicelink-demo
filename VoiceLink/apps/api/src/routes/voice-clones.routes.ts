import { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";

import {
  CreateVoiceCloneInput,
  type VoiceClone,
  VoiceProvider,
} from "@voiceplatform/shared";

import { getDb } from "../db/connection.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTenant, tenantScope } from "../middleware/tenant.js";
import { ttsForProvider, TTSError } from "../adapters/tts/index.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("voice-clones");
export const voiceClonesRouter = Router();

voiceClonesRouter.use(requireAuth, requireTenant);

voiceClonesRouter.get("/", async (req: Request, res: Response) => {
  const clones = await getDb()
    .collection<VoiceClone>("voice_clones")
    .find(tenantScope(req))
    .toArray();
  res.json({ voiceClones: clones });
});

voiceClonesRouter.get("/:id", async (req: Request, res: Response) => {
  const clone = await getDb()
    .collection<VoiceClone>("voice_clones")
    .findOne(tenantScope(req, { _id: req.params.id }));
  if (!clone) {
    res.status(404).end();
    return;
  }
  res.json(clone);
});

const CreateBody = CreateVoiceCloneInput.extend({
  // Audio comes in as base64 (small clips for v1; switch to signed-S3
  // upload before tenants ship large samples).
  audioBase64: z.string().min(1),
  fileName: z.string().min(1).max(120),
  language: z.string().default("en"),
  mode: z.enum(["similarity", "stability"]).optional(),
});

voiceClonesRouter.post("/", async (req: Request, res: Response) => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const { audioBase64, fileName, language, mode, ...meta } = parsed.data;

  try {
    const provider = ttsForProvider(meta.provider);
    const { providerVoiceId } = await provider.cloneVoice({
      audioBuffer: Buffer.from(audioBase64, "base64"),
      fileName,
      name: meta.name,
      language,
      mode,
    });

    const now = new Date();
    const id = new ObjectId().toString();
    const clone: VoiceClone = {
      _id: id,
      tenantId: req.tenantId!,
      provider: meta.provider,
      providerVoiceId,
      name: meta.name,
      sampleUrl: meta.sampleUrl,
      isPublic: meta.isPublic ?? false,
      createdAt: now,
      updatedAt: now,
    };
    await getDb().collection<VoiceClone>("voice_clones").insertOne(clone);
    log.info({ id, tenantId: req.tenantId }, "voice clone created");
    res.status(201).json(clone);
  } catch (err) {
    if (err instanceof TTSError) {
      res.status(err.status ?? 502).json({ error: err.message });
      return;
    }
    throw err;
  }
});

voiceClonesRouter.delete("/:id", async (req: Request, res: Response) => {
  const clone = await getDb()
    .collection<VoiceClone>("voice_clones")
    .findOne(tenantScope(req, { _id: req.params.id }));
  if (!clone) {
    res.status(404).end();
    return;
  }
  try {
    await ttsForProvider(clone.provider).deleteVoice(clone.providerVoiceId);
  } catch (err) {
    log.warn({ err, id: clone._id }, "provider delete failed; removing local row anyway");
  }
  await getDb()
    .collection<VoiceClone>("voice_clones")
    .deleteOne(tenantScope(req, { _id: req.params.id }));
  res.status(204).end();
});

const PreviewBody = z.object({
  voiceId: z.string().min(1),
  provider: VoiceProvider,
  text: z.string().min(1).max(500),
  outputFormat: z.enum(["telephony", "browser"]).default("browser"),
});

voiceClonesRouter.post("/preview", async (req: Request, res: Response) => {
  const parsed = PreviewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { provider, voiceId, text, outputFormat } = parsed.data;
  const chunks: Buffer[] = [];
  try {
    const tts = ttsForProvider(provider);
    await new Promise<void>((resolve, reject) => {
      tts.streamTTS({
        voiceId,
        text,
        outputFormat,
        onChunk: (b64) => chunks.push(Buffer.from(b64, "base64")),
        onDone: resolve,
        onError: reject,
      });
    });
    res.setHeader("content-type", outputFormat === "browser" ? "audio/mpeg" : "application/octet-stream");
    res.send(Buffer.concat(chunks));
  } catch (err) {
    if (err instanceof TTSError) {
      res.status(err.status ?? 502).json({ error: err.message });
      return;
    }
    throw err;
  }
});
