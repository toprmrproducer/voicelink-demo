import { Router, type Request, type Response } from "express";

import type { VoiceProvider } from "@voiceplatform/shared";

import { requireAuth } from "../middleware/auth.js";

export interface LibraryVoiceEntry {
  provider: VoiceProvider;
  providerVoiceId: string;
  name: string;
  language?: string;
  gender?: "male" | "female" | "neutral";
  previewUrl?: string;
}

/**
 * Static catalog of stock voices, curated for v1. Tenants pick from this
 * list in the agent editor. Cloned voices are listed separately via
 * /voice-clones. Realtime providers (openai-realtime, gemini-live) speak
 * directly through their model, so the "voice" here is the model's named
 * voice option rather than a TTS adapter voiceId.
 */
const STOCK_VOICES: LibraryVoiceEntry[] = [
  // OpenAI Realtime — voice option names from the Realtime API.
  { provider: "openai-realtime", providerVoiceId: "alloy", name: "Alloy", language: "en", gender: "neutral" },
  { provider: "openai-realtime", providerVoiceId: "echo", name: "Echo", language: "en", gender: "male" },
  { provider: "openai-realtime", providerVoiceId: "fable", name: "Fable", language: "en", gender: "neutral" },
  { provider: "openai-realtime", providerVoiceId: "onyx", name: "Onyx", language: "en", gender: "male" },
  { provider: "openai-realtime", providerVoiceId: "nova", name: "Nova", language: "en", gender: "female" },
  { provider: "openai-realtime", providerVoiceId: "shimmer", name: "Shimmer", language: "en", gender: "female" },

  // Gemini Live — small starter set; expand once we benchmark them in prod.
  { provider: "gemini-live", providerVoiceId: "aoede", name: "Aoede", language: "en", gender: "female" },
  { provider: "gemini-live", providerVoiceId: "puck", name: "Puck", language: "en", gender: "male" },

  // ElevenLabs — curated subset of their public library (commonly-licensed).
  { provider: "elevenlabs", providerVoiceId: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", language: "en", gender: "female" },
  { provider: "elevenlabs", providerVoiceId: "AZnzlk1XvdvUeBnXmlld", name: "Domi", language: "en", gender: "female" },
  { provider: "elevenlabs", providerVoiceId: "EXAVITQu4vr4xnSDxMaL", name: "Bella", language: "en", gender: "female" },
  { provider: "elevenlabs", providerVoiceId: "ErXwobaYiN019PkySvjV", name: "Antoni", language: "en", gender: "male" },
  { provider: "elevenlabs", providerVoiceId: "VR6AewLTigWG4xSOukaG", name: "Arnold", language: "en", gender: "male" },

  // Cartesia — small starter set; full library is huge, expand by demand.
  { provider: "cartesia", providerVoiceId: "a0e99841-438c-4a64-b679-ae501e7d6091", name: "Barbershop Man", language: "en", gender: "male" },
  { provider: "cartesia", providerVoiceId: "c8605446-247c-4d39-acd4-8f4c28aa363c", name: "Calm Lady", language: "en", gender: "female" },
  { provider: "cartesia", providerVoiceId: "bf0a246a-8642-498a-9950-80c35e9276b5", name: "Sophie", language: "en", gender: "female" },

  // PlayHT — curated subset.
  { provider: "playht", providerVoiceId: "jennifer", name: "Jennifer", language: "en", gender: "female" },
  { provider: "playht", providerVoiceId: "michael", name: "Michael", language: "en", gender: "male" },
];

export const voicesRouter = Router();

voicesRouter.use(requireAuth);

voicesRouter.get("/", (req: Request, res: Response) => {
  const providerFilter = req.query.provider;
  const voices =
    typeof providerFilter === "string"
      ? STOCK_VOICES.filter((v) => v.provider === providerFilter)
      : STOCK_VOICES;
  res.json({ voices });
});
