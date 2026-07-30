import { createLogger } from "../../lib/logger.js";

import {
  TTSError,
  type CloneVoiceParams,
  type CloneVoiceResult,
  type LibraryVoice,
  type TTSProvider,
  type TTSStreamOptions,
} from "./types.js";

const log = createLogger("tts.elevenlabs");

const BASE = "https://api.elevenlabs.io/v1";
// Optimised for low-latency streaming voice agents.
const DEFAULT_MODEL = "eleven_turbo_v2_5";

function key(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new TTSError("ELEVENLABS_API_KEY not configured", 503, "elevenlabs");
  return k;
}

export class ElevenLabsProvider implements TTSProvider {
  async cloneVoice(params: CloneVoiceParams): Promise<CloneVoiceResult> {
    const form = new FormData();
    const mime = params.fileName.endsWith(".mp3") ? "audio/mpeg" : "audio/wav";
    form.set(
      "files",
      new Blob([new Uint8Array(params.audioBuffer)], { type: mime }),
      params.fileName,
    );
    form.set("name", params.name);
    if (params.description) form.set("description", params.description);
    if (params.removeBackgroundNoise !== undefined) {
      form.set("remove_background_noise", String(params.removeBackgroundNoise));
    }

    const res = await fetch(`${BASE}/voices/add`, {
      method: "POST",
      headers: { "xi-api-key": key() },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new TTSError(`clone failed: ${text}`, res.status, "elevenlabs");
    }
    const data = (await res.json()) as { voice_id: string };
    log.info({ voiceId: data.voice_id, name: params.name }, "voice cloned");
    return { providerVoiceId: data.voice_id };
  }

  async streamTTS(opts: TTSStreamOptions): Promise<void> {
    const format = opts.outputFormat ?? "telephony";
    const outputFormat =
      format === "telephony" ? "ulaw_8000" : "mp3_44100_128";

    const res = await fetch(
      `${BASE}/text-to-speech/${opts.voiceId}/stream?output_format=${outputFormat}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": key(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text: opts.text,
          model_id: DEFAULT_MODEL,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
        signal: opts.signal,
      },
    );
    if (!res.ok || !res.body) {
      const text = res.body ? await res.text() : "no body";
      opts.onError(new TTSError(`stream failed: ${text}`, res.status, "elevenlabs"));
      return;
    }

    const reader = res.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          opts.onChunk(Buffer.from(value).toString("base64"));
        }
      }
      opts.onDone();
    } catch (err) {
      opts.onError(err as Error);
    }
  }

  async deleteVoice(providerVoiceId: string): Promise<void> {
    const res = await fetch(`${BASE}/voices/${providerVoiceId}`, {
      method: "DELETE",
      headers: { "xi-api-key": key() },
    });
    if (!res.ok && res.status !== 404) {
      throw new TTSError(`delete failed: ${res.statusText}`, res.status, "elevenlabs");
    }
  }

  async listLibraryVoices(): Promise<LibraryVoice[]> {
    const res = await fetch(`${BASE}/voices`, {
      headers: { "xi-api-key": key() },
    });
    if (!res.ok) {
      throw new TTSError(`list failed: ${res.statusText}`, res.status, "elevenlabs");
    }
    const data = (await res.json()) as { voices: Array<{ voice_id: string; name: string; labels?: { gender?: string; language?: string }; preview_url?: string }> };
    return data.voices.map((v) => ({
      id: v.voice_id,
      name: v.name,
      gender: v.labels?.gender as LibraryVoice["gender"],
      language: v.labels?.language,
      previewUrl: v.preview_url,
    }));
  }
}
