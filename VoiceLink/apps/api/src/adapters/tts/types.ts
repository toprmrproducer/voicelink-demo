/**
 * Provider-agnostic interface for TTS + voice cloning. Implementations
 * cover ElevenLabs, Cartesia, PlayHT (S6) and are interchangeable from
 * the agent's voice config.
 *
 * Telephony output is **mulaw 8 kHz** (Twilio / Voicelink compatible).
 * Browser output is MP3 for in-app preview.
 */
export type TTSOutputFormat = "telephony" | "browser";

export interface CloneVoiceParams {
  audioBuffer: Buffer;
  fileName: string;
  name: string;
  language: string;
  description?: string;
  /** Provider may use this to denoise before training. */
  removeBackgroundNoise?: boolean;
  /**
   * Cartesia-specific: "similarity" (5s clip, faster) vs "stability"
   * (10-20s clip, studio quality). Ignored by other providers.
   */
  mode?: "similarity" | "stability";
}

export interface CloneVoiceResult {
  providerVoiceId: string;
}

export interface TTSStreamOptions {
  voiceId: string;
  text: string;
  /** base64 audio chunk — telephony=mulaw 8 kHz, browser=MP3 fragment. */
  onChunk: (base64: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
  signal?: AbortSignal;
  /** Default "telephony" so call paths stay unchanged. */
  outputFormat?: TTSOutputFormat;
}

export interface LibraryVoice {
  id: string;
  name: string;
  language?: string;
  gender?: "male" | "female" | "other";
  previewUrl?: string;
}

export interface TTSProvider {
  cloneVoice(params: CloneVoiceParams): Promise<CloneVoiceResult>;
  streamTTS(opts: TTSStreamOptions): Promise<void>;
  deleteVoice(providerVoiceId: string): Promise<void>;
  /** Optional — only providers with a public library implement it. */
  listLibraryVoices?(opts?: {
    language?: string;
    query?: string;
  }): Promise<LibraryVoice[]>;
}

export class TTSError extends Error {
  constructor(message: string, public status?: number, public provider?: string) {
    super(message);
    this.name = "TTSError";
  }
}
