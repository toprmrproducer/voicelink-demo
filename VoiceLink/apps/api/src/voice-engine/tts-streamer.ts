import type { TTSProvider, TTSOutputFormat } from "../adapters/tts/types.js";

/**
 * Buffers streaming text from a realtime model into sentence-shaped
 * chunks, runs each chunk through TTS, and emits audio. Aborts in flight
 * when barge-in fires (call ttsStreamer.cancel()).
 *
 * Used when an agent's voice is a custom clone — the realtime model is
 * configured to return text-only (modalities: ["text"]) and the
 * streamer pipes that text through ElevenLabs/Cartesia/PlayHT.
 */
export interface TTSStreamerOptions {
  provider: TTSProvider;
  voiceId: string;
  outputFormat?: TTSOutputFormat;
  onChunk: (base64: string) => void;
  onError?: (err: Error) => void;
}

export class TTSStreamer {
  private buffer = "";
  private currentAbort?: AbortController;
  private cancelled = false;

  constructor(private opts: TTSStreamerOptions) {}

  /** Push more streaming text. Sentences get synthesised as they complete. */
  push(delta: string): void {
    if (this.cancelled) return;
    this.buffer += delta;
    let cut: number;
    while ((cut = nextSentenceEnd(this.buffer)) !== -1) {
      const sentence = this.buffer.slice(0, cut + 1).trim();
      this.buffer = this.buffer.slice(cut + 1);
      if (sentence) void this.synthesize(sentence);
    }
  }

  /** Flush any trailing text and finish. */
  flush(): void {
    if (this.cancelled) return;
    const trailing = this.buffer.trim();
    this.buffer = "";
    if (trailing) void this.synthesize(trailing);
  }

  /** Barge-in: abort the in-flight HTTP request, drop unsynthesised text. */
  cancel(): void {
    this.cancelled = true;
    this.buffer = "";
    this.currentAbort?.abort();
  }

  private async synthesize(text: string): Promise<void> {
    if (this.cancelled) return;
    this.currentAbort = new AbortController();
    await this.opts.provider.streamTTS({
      voiceId: this.opts.voiceId,
      text,
      outputFormat: this.opts.outputFormat,
      signal: this.currentAbort.signal,
      onChunk: (base64) => {
        if (!this.cancelled) this.opts.onChunk(base64);
      },
      onDone: () => {},
      onError: (err) => this.opts.onError?.(err),
    });
  }
}

/**
 * Returns the index of the last sentence-terminating character in `s`,
 * or -1 if no full sentence is buffered yet. Splits on . ! ? — plus
 * obvious end markers like \n. Treats common abbreviations (Mr., Dr.,
 * etc.) heuristically so we don't synthesise "Mr" alone.
 */
export function nextSentenceEnd(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "." && c !== "!" && c !== "?" && c !== "\n") continue;
    if (c === "." && i > 0) {
      // Skip "Mr.", "Dr.", "Mrs.", common abbreviations
      const last3 = s.slice(Math.max(0, i - 3), i).toLowerCase();
      if (/(mr|dr|mrs|ms|st|jr|sr|vs|etc|inc|ltd|co)$/.test(last3)) continue;
      // Skip decimals "3.14"
      if (/\d/.test(s[i - 1] ?? "") && /\d/.test(s[i + 1] ?? "")) continue;
    }
    return i;
  }
  return -1;
}
