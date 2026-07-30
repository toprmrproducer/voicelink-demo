import { createLogger } from "../../lib/logger.js";

import {
  TTSError,
  type CloneVoiceParams,
  type CloneVoiceResult,
  type TTSProvider,
  type TTSStreamOptions,
} from "./types.js";

const log = createLogger("tts.playht");

const BASE = "https://api.play.ht/api/v2";
const DEFAULT_MODEL = "PlayDialog";

function creds(): { userId: string; apiKey: string } {
  const userId = process.env.PLAYHT_USER_ID;
  const apiKey = process.env.PLAYHT_API_KEY;
  if (!userId || !apiKey) {
    throw new TTSError("PLAYHT_USER_ID / PLAYHT_API_KEY not configured", 503, "playht");
  }
  return { userId, apiKey };
}

function headers(extra: Record<string, string> = {}): HeadersInit {
  const c = creds();
  return {
    "X-USER-ID": c.userId,
    AUTHORIZATION: c.apiKey,
    accept: "application/json",
    ...extra,
  };
}

export class PlayHTProvider implements TTSProvider {
  async cloneVoice(params: CloneVoiceParams): Promise<CloneVoiceResult> {
    const form = new FormData();
    const mime = params.fileName.endsWith(".mp3") ? "audio/mpeg" : "audio/wav";
    form.set(
      "sample_file",
      new Blob([new Uint8Array(params.audioBuffer)], { type: mime }),
      params.fileName,
    );
    form.set("voice_name", params.name);

    const res = await fetch(`${BASE}/cloned-voices/instant`, {
      method: "POST",
      headers: headers(),
      body: form,
    });
    if (!res.ok) {
      throw new TTSError(`clone failed: ${await res.text()}`, res.status, "playht");
    }
    const data = (await res.json()) as { id: string };
    log.info({ voiceId: data.id, name: params.name }, "voice cloned");
    return { providerVoiceId: data.id };
  }

  async streamTTS(opts: TTSStreamOptions): Promise<void> {
    const format = opts.outputFormat ?? "telephony";
    const outputFormat = format === "telephony" ? "mulaw" : "mp3";

    const res = await fetch(`${BASE}/tts/stream`, {
      method: "POST",
      headers: headers({
        accept: "audio/mpeg",
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        text: opts.text,
        voice: opts.voiceId,
        voice_engine: DEFAULT_MODEL,
        output_format: outputFormat,
        sample_rate: format === "telephony" ? 8000 : 44100,
      }),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      opts.onError(
        new TTSError(`stream failed: ${res.statusText}`, res.status, "playht"),
      );
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
    const res = await fetch(`${BASE}/cloned-voices/${providerVoiceId}`, {
      method: "DELETE",
      headers: headers(),
    });
    if (!res.ok && res.status !== 404) {
      throw new TTSError(`delete failed: ${res.statusText}`, res.status, "playht");
    }
  }
}
