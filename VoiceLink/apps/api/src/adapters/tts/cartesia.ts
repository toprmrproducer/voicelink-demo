import { createLogger } from "../../lib/logger.js";

import {
  TTSError,
  type CloneVoiceParams,
  type CloneVoiceResult,
  type TTSProvider,
  type TTSStreamOptions,
} from "./types.js";

const log = createLogger("tts.cartesia");

const BASE = "https://api.cartesia.ai";
const API_VERSION = "2024-11-13";
const DEFAULT_MODEL = "sonic-2";

function key(): string {
  const k = process.env.CARTESIA_API_KEY;
  if (!k) throw new TTSError("CARTESIA_API_KEY not configured", 503, "cartesia");
  return k;
}

function headers(extra: Record<string, string> = {}): HeadersInit {
  return {
    "X-API-Key": key(),
    "Cartesia-Version": API_VERSION,
    ...extra,
  };
}

export class CartesiaProvider implements TTSProvider {
  async cloneVoice(params: CloneVoiceParams): Promise<CloneVoiceResult> {
    const form = new FormData();
    const mime = params.fileName.endsWith(".mp3") ? "audio/mpeg" : "audio/wav";
    form.set(
      "clip",
      new Blob([new Uint8Array(params.audioBuffer)], { type: mime }),
      params.fileName,
    );
    form.set("name", params.name);
    form.set("language", params.language);
    if (params.description) form.set("description", params.description);
    // "stability" mode uses Cartesia's longer-clip studio path.
    form.set("mode", params.mode === "stability" ? "stability" : "similarity");

    const res = await fetch(`${BASE}/voices/clone`, {
      method: "POST",
      headers: headers(),
      body: form,
    });
    if (!res.ok) {
      throw new TTSError(`clone failed: ${await res.text()}`, res.status, "cartesia");
    }
    const data = (await res.json()) as { id: string };
    log.info({ voiceId: data.id, name: params.name }, "voice cloned");
    return { providerVoiceId: data.id };
  }

  async streamTTS(opts: TTSStreamOptions): Promise<void> {
    const format = opts.outputFormat ?? "telephony";
    const outputFormat =
      format === "telephony"
        ? { container: "raw", encoding: "pcm_mulaw", sample_rate: 8000 }
        : { container: "mp3", encoding: "mp3", sample_rate: 44100 };

    const res = await fetch(`${BASE}/tts/sse`, {
      method: "POST",
      headers: headers({ "content-type": "application/json" }),
      body: JSON.stringify({
        model_id: DEFAULT_MODEL,
        voice: { mode: "id", id: opts.voiceId },
        transcript: opts.text,
        language: "en",
        output_format: outputFormat,
      }),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      opts.onError(
        new TTSError(`stream failed: ${res.statusText}`, res.status, "cartesia"),
      );
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // SSE — events separated by blank lines, each event has data: lines
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const event = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const data = event
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("");
          if (!data) continue;
          try {
            const msg = JSON.parse(data) as { type?: string; data?: string };
            if (msg.type === "chunk" && msg.data) opts.onChunk(msg.data);
          } catch {
            /* skip malformed lines */
          }
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
      headers: headers(),
    });
    if (!res.ok && res.status !== 404) {
      throw new TTSError(`delete failed: ${res.statusText}`, res.status, "cartesia");
    }
  }
}
