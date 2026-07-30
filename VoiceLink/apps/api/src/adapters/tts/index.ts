import type { VoiceProvider } from "@voiceplatform/shared";

import { CartesiaProvider } from "./cartesia.js";
import { ElevenLabsProvider } from "./elevenlabs.js";
import { PlayHTProvider } from "./playht.js";
import type { TTSProvider } from "./types.js";

export * from "./types.js";
export { ElevenLabsProvider, CartesiaProvider, PlayHTProvider };

/**
 * Returns the right TTSProvider for an agent voice setting. Throws on
 * realtime models (openai-realtime / gemini-live) which don't go through
 * a TTS adapter — the realtime model speaks directly.
 */
export function ttsForProvider(provider: VoiceProvider): TTSProvider {
  switch (provider) {
    case "elevenlabs":
      return new ElevenLabsProvider();
    case "cartesia":
      return new CartesiaProvider();
    case "playht":
      return new PlayHTProvider();
    case "openai-realtime":
    case "gemini-live":
      throw new Error(
        `Voice provider "${provider}" speaks via realtime model, not TTS adapter`,
      );
    case "cloned":
      throw new Error(
        `Voice provider "cloned" requires looking up the clone's underlying provider`,
      );
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown voice provider: ${_exhaustive}`);
    }
  }
}
