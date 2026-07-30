import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";

import type { RealtimeProvider, RealtimeProviderConfig } from "./types.js";
import { createLogger } from "../../lib/logger.js";
import { pcm16Resample } from "../../voice-engine/audio-pipeline.js";

const log = createLogger("gemini-live");

/**
 * Live (BidiGenerateContent) integration with Google's Gemini Live API,
 * via the official @google/genai SDK.
 *
 * Audio contract on the session-manager boundary is PCM16 24 kHz both
 * ways (same as OpenAI Realtime), so the session bridge stays uniform.
 * Gemini Live, however, takes 16 kHz PCM input and emits 24 kHz PCM
 * output — so we downsample 24→16 on the way in and pass output through
 * untouched.
 *
 * `agent.llm.realtimeModel` is the platform's logical id ("gemini-live-2.0").
 * The real model name is resolved here (env override: GEMINI_LIVE_MODEL).
 */
const DEFAULT_LIVE_MODEL = "gemini-3.1-flash-live-preview";
const DEFAULT_VOICE = "Puck";

function resolveModel(logicalModel: string): string {
  const override = process.env.GEMINI_LIVE_MODEL?.trim();
  if (override) return override;
  // The schema's "gemini-live-2.0" is a logical alias, not a real model id.
  if (logicalModel.startsWith("gemini-live")) return DEFAULT_LIVE_MODEL;
  return logicalModel;
}

export class GeminiLiveProvider implements RealtimeProvider {
  private session?: Session;
  private closed = false;
  private audioHandlers: ((frame: Buffer) => void)[] = [];
  private textHandlers: ((delta: string) => void)[] = [];
  private turnEndHandlers: (() => void)[] = [];
  private errorHandlers: ((err: Error) => void)[] = [];
  private outFrames = 0;

  constructor(private cfg: RealtimeProviderConfig) {}

  async connect(): Promise<void> {
    const apiKey = this.cfg.apiKey;
    if (!apiKey) throw new Error("GEMINI_API_KEY missing — cannot start gemini-live");

    const model = resolveModel(this.cfg.model);
    const voiceName = this.cfg.voice || DEFAULT_VOICE;
    const ai = new GoogleGenAI({ apiKey });

    this.session = await ai.live.connect({
      model,
      config: {
        responseModalities: [Modality.AUDIO],
        ...(this.cfg.systemPrompt
          ? { systemInstruction: this.cfg.systemPrompt }
          : {}),
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
        },
        // Server-side VAD handles barge-in: when the caller speaks while
        // the model is talking, Gemini interrupts itself and sends
        // serverContent.interrupted=true.
      },
      callbacks: {
        onopen: () => log.info({ model, voiceName }, "gemini live connected"),
        onmessage: (msg: LiveServerMessage) => this.handleMessage(msg),
        onerror: (e: ErrorEvent) => {
          const err = new Error(`gemini live error: ${e.message ?? String(e)}`);
          for (const h of this.errorHandlers) h(err);
        },
        onclose: () => {
          if (!this.closed) log.warn("gemini live socket closed by server");
        },
      },
    });
    log.info({ model }, "gemini live session established");
  }

  private handleMessage(msg: LiveServerMessage): void {
    const sc = msg.serverContent;
    if (!sc) return;

    // Audio + text parts from the model's turn.
    const parts = sc.modelTurn?.parts ?? [];
    for (const part of parts) {
      const inline = part.inlineData;
      if (inline?.data && (inline.mimeType ?? "").startsWith("audio/")) {
        const frame = Buffer.from(inline.data, "base64"); // PCM16, rate per mimeType
        if (this.outFrames < 3) {
          log.info({ mimeType: inline.mimeType, bytes: frame.length }, "gemini output audio frame");
          this.outFrames++;
        }
        for (const h of this.audioHandlers) h(frame);
      }
      if (typeof part.text === "string" && part.text.length > 0) {
        for (const h of this.textHandlers) h(part.text);
      }
    }

    // Barge-in: the model was interrupted by the caller speaking.
    if (sc.interrupted) {
      log.info("gemini live: model interrupted (barge-in)");
    }
    if (sc.turnComplete) {
      for (const h of this.turnEndHandlers) h();
    }
  }

  sendAudio(frame: Buffer): void {
    if (!this.session || this.closed) return;
    // Bridge delivers PCM16 24 kHz; Gemini Live input is 16 kHz.
    const pcm16k = pcm16Resample(frame, 24_000, 16_000);
    this.session.sendRealtimeInput({
      audio: { data: pcm16k.toString("base64"), mimeType: "audio/pcm;rate=16000" },
    });
  }

  sendText(text: string): void {
    if (!this.session || this.closed) return;
    this.session.sendClientContent({
      turns: [{ role: "user", parts: [{ text }] }],
      turnComplete: true,
    });
  }

  onAudio(h: (frame: Buffer) => void) { this.audioHandlers.push(h); }
  onText(h: (delta: string) => void) { this.textHandlers.push(h); }
  onTurnEnd(h: () => void) { this.turnEndHandlers.push(h); }
  onError(h: (err: Error) => void) { this.errorHandlers.push(h); }

  /**
   * Gemini Live handles interruption server-side via VAD on the input
   * stream, so there's no explicit cancel RPC. We keep streaming the
   * caller's audio and the model self-interrupts. No-op by design.
   */
  cancel(): void {
    /* server-side VAD handles barge-in */
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      this.session?.close();
    } catch (err) {
      log.warn({ err }, "error closing gemini live session");
    }
  }
}
