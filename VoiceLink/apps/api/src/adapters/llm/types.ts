/**
 * Provider-agnostic interface for realtime voice models.
 *
 * Implementations connect to OpenAI Realtime, Gemini Live, or a fake
 * (for tests). The session-manager owns one provider per call and
 * forwards audio + text in both directions.
 */
export type RealtimeModality = "text" | "audio";

export interface RealtimeProviderConfig {
  apiKey: string;
  model: string;
  voice?: string;
  // ["text","audio"] = default (provider speaks). ["text"] = provider
  // returns text only; the voice-engine pipes that text through a TTS
  // adapter (Stream S6) for custom voices.
  modalities?: RealtimeModality[];
  systemPrompt?: string;
  temperature?: number;
}

export interface RealtimeProvider {
  /** Open the WS / HTTP-stream connection to the provider. */
  connect(): Promise<void>;

  /** Push a PCM16 frame (mono, 16 kHz unless model says otherwise). */
  sendAudio(frame: Buffer): void;

  /** Send a text message — used for tool results and out-of-band injects. */
  sendText(text: string): void;

  /** Audio frames the provider speaks back. */
  onAudio(handler: (frame: Buffer) => void): void;

  /** Streaming text deltas from the provider (interleaved with audio). */
  onText(handler: (delta: string) => void): void;

  /** Fires when the provider thinks the turn is done. */
  onTurnEnd(handler: () => void): void;

  /** Fires on transport / model errors. */
  onError(handler: (err: Error) => void): void;

  /**
   * Cancel any in-flight model response. Called when the caller
   * interrupts (Voicelink fires `{event:"clear"}` for barge-in). Best
   * effort — providers that don't support cancellation can no-op.
   */
  cancel?(): void;

  close(): Promise<void>;
}
