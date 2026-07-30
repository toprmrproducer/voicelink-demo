/**
 * Audio helpers for telephony pipelines.
 *
 * Voicelink (and Twilio) carry G.711 µ-law at 8 kHz, 8-bit samples.
 * Realtime models speak PCM16 at 24 kHz. The pipeline translates
 * between them at the WS boundary.
 *
 * For Phase 1 we implement only the decode/encode primitives; the
 * resampler (8 kHz <-> 24 kHz) is wired in once we have a real call
 * to test against (S1 with real Voicelink + S2 with real OpenAI).
 */

const MU = 0xff;
const BIAS = 0x84;

export function mulawDecodeSample(mu: number): number {
  mu = ~mu & MU;
  const sign = mu & 0x80;
  const exponent = (mu >> 4) & 0x07;
  const mantissa = mu & 0x0f;
  let sample = ((mantissa << 3) + BIAS) << exponent;
  sample -= BIAS;
  return sign ? -sample : sample;
}

export function mulawEncodeSample(pcm: number): number {
  const sign = pcm < 0 ? 0x80 : 0;
  if (pcm < 0) pcm = -pcm;
  if (pcm > 0x7fff) pcm = 0x7fff;
  pcm = pcm + BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (pcm & mask) === 0 && exponent > 0; exponent--, mask >>= 1) {
    // noop — find segment
  }
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & MU;
}

export function mulawToPcm16(mulaw: Buffer): Buffer {
  const out = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) {
    out.writeInt16LE(mulawDecodeSample(mulaw[i]), i * 2);
  }
  return out;
}

export function pcm16ToMulaw(pcm: Buffer): Buffer {
  const samples = pcm.length / 2;
  const out = Buffer.alloc(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = mulawEncodeSample(pcm.readInt16LE(i * 2));
  }
  return out;
}

/** Rough VAD — barge-in trips when energy exceeds threshold for N frames. */
export class EnergyVAD {
  private aboveCount = 0;
  constructor(
    private threshold = 600,
    private requiredFrames = 3,
  ) {}

  /** Returns true on the frame that crosses the barge-in threshold. */
  feed(pcm16: Buffer): boolean {
    let sum = 0;
    for (let i = 0; i < pcm16.length; i += 2) {
      const s = pcm16.readInt16LE(i);
      sum += Math.abs(s);
    }
    const energy = sum / (pcm16.length / 2);
    if (energy >= this.threshold) {
      this.aboveCount++;
      if (this.aboveCount === this.requiredFrames) return true;
    } else {
      this.aboveCount = 0;
    }
    return false;
  }

  reset(): void {
    this.aboveCount = 0;
  }
}

// ─────────────────── Resampling ───────────────────
//
// Telephony carries 8 kHz audio; OpenAI Realtime + most modern speech
// models speak 24 kHz PCM16. We stay in PCM16 for both ends and only
// touch the µ-law encode/decode at the WS boundary, so the resampler
// only needs to handle PCM16 → PCM16.
//
// Linear interpolation is "good enough" at telephony quality. A poly-
// phase FIR would sound better but adds 2 KB of coefficients and one
// dependency for ~1 dB of perceptual win — not worth it on G.711.

/**
 * Upsample 8 kHz PCM16 to 24 kHz PCM16 using linear interpolation.
 * Output length = input length × 3.
 */
export function pcm16Upsample8kTo24k(pcm8k: Buffer): Buffer {
  const inSamples = pcm8k.length / 2;
  if (inSamples === 0) return Buffer.alloc(0);
  const outSamples = inSamples * 3;
  const out = Buffer.alloc(outSamples * 2);

  for (let i = 0; i < inSamples; i++) {
    const a = pcm8k.readInt16LE(i * 2);
    // Use the next sample for interpolation; clamp at the tail.
    const b = i + 1 < inSamples ? pcm8k.readInt16LE((i + 1) * 2) : a;
    const baseOut = i * 3;
    out.writeInt16LE(a, baseOut * 2);
    out.writeInt16LE(Math.round(a + (b - a) / 3), (baseOut + 1) * 2);
    out.writeInt16LE(Math.round(a + (2 * (b - a)) / 3), (baseOut + 2) * 2);
  }
  return out;
}

/**
 * Downsample 24 kHz PCM16 to 8 kHz PCM16 by averaging each group of
 * three input samples. Acts as a cheap low-pass filter to limit
 * aliasing at the 4 kHz Nyquist boundary. Output length ≈ input × 1/3.
 *
 * Carry-over samples (when input length isn't a multiple of 3) are
 * appended to the next call's input — set `state` to a fresh
 * `ResampleState` per call session to preserve continuity across
 * frames; pass `null` for stateless single-shot use.
 */
export interface ResampleState {
  carry: Buffer;
}

export function makeResampleState(): ResampleState {
  return { carry: Buffer.alloc(0) };
}

export function pcm16Downsample24kTo8k(
  pcm24k: Buffer,
  state: ResampleState | null = null,
): Buffer {
  const carry = state ? state.carry : Buffer.alloc(0);
  const buf = carry.length > 0 ? Buffer.concat([carry, pcm24k]) : pcm24k;
  const inSamples = buf.length / 2;
  const outSamples = Math.floor(inSamples / 3);
  const consumed = outSamples * 3;
  const out = Buffer.alloc(outSamples * 2);

  for (let i = 0; i < outSamples; i++) {
    const s0 = buf.readInt16LE(i * 3 * 2);
    const s1 = buf.readInt16LE((i * 3 + 1) * 2);
    const s2 = buf.readInt16LE((i * 3 + 2) * 2);
    out.writeInt16LE(Math.round((s0 + s1 + s2) / 3), i * 2);
  }

  if (state) {
    // Save unconsumed tail (0, 1, or 2 samples worth of bytes).
    const remainingBytes = (inSamples - consumed) * 2;
    state.carry = remainingBytes > 0
      ? Buffer.from(buf.subarray(buf.length - remainingBytes))
      : Buffer.alloc(0);
  }
  return out;
}

/**
 * Generic linear-interpolation resampler for PCM16 mono. Used by the
 * Gemini Live provider, which takes 16 kHz input but the telephony
 * bridge produces 24 kHz (and Gemini speaks 24 kHz back, which the
 * bridge already expects). Stateless per-buffer; the small
 * discontinuity at 20 ms frame edges is inaudible at telephony quality.
 */
export function pcm16Resample(pcm: Buffer, inRate: number, outRate: number): Buffer {
  const inSamples = pcm.length / 2;
  if (inSamples === 0 || inRate === outRate) return pcm;
  const outSamples = Math.max(1, Math.round((inSamples * outRate) / inRate));
  const out = Buffer.alloc(outSamples * 2);
  const step = outSamples > 1 ? (inSamples - 1) / (outSamples - 1) : 0;
  for (let j = 0; j < outSamples; j++) {
    const pos = j * step;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, inSamples - 1);
    const frac = pos - i0;
    const s0 = pcm.readInt16LE(i0 * 2);
    const s1 = pcm.readInt16LE(i1 * 2);
    out.writeInt16LE(Math.round(s0 + (s1 - s0) * frac), j * 2);
  }
  return out;
}

// ─────────────────── G.711 A-law (ITU-T) ───────────────────
//
// VoiceLink (and most of EU/Asia/India telephony) uses A-law, NOT µ-law.
// Encoding the wrong companding curve turns every sample into noise — the
// "radio static" symptom. Standard Sun g711.c port.

const ALAW_SEG_END = [0x1f, 0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff];

export function alawEncodeSample(pcm: number): number {
  let val = pcm >> 3; // 16-bit linear → 13-bit
  let mask: number;
  if (val >= 0) {
    mask = 0xd5;
  } else {
    mask = 0x55;
    val = -val - 1;
    if (val < 0) val = 0;
  }
  let seg = 8;
  for (let i = 0; i < 8; i++) {
    if (val <= ALAW_SEG_END[i]) { seg = i; break; }
  }
  if (seg >= 8) return (0x7f ^ mask) & 0xff;
  let aval = seg << 4;
  aval |= seg < 2 ? (val >> 1) & 0x0f : (val >> seg) & 0x0f;
  return (aval ^ mask) & 0xff;
}

export function alawDecodeSample(aval: number): number {
  aval ^= 0x55;
  let t = (aval & 0x0f) << 4;
  const seg = (aval & 0x70) >> 4;
  if (seg === 0) t += 8;
  else if (seg === 1) t += 0x108;
  else { t += 0x108; t <<= seg - 1; }
  return aval & 0x80 ? t : -t;
}

export function alawToPcm16(alaw: Buffer): Buffer {
  const out = Buffer.alloc(alaw.length * 2);
  for (let i = 0; i < alaw.length; i++) out.writeInt16LE(alawDecodeSample(alaw[i]), i * 2);
  return out;
}

export function pcm16ToAlaw(pcm: Buffer): Buffer {
  const samples = pcm.length / 2;
  const out = Buffer.alloc(samples);
  for (let i = 0; i < samples; i++) out[i] = alawEncodeSample(pcm.readInt16LE(i * 2));
  return out;
}

/** Convenience: A-law 8 kHz → PCM16 24 kHz. */
export function alaw8kToPcm16_24k(alaw: Buffer): Buffer {
  return pcm16Upsample8kTo24k(alawToPcm16(alaw));
}

/** Convenience: PCM16 24 kHz → A-law 8 kHz, with optional streaming state. */
export function pcm16_24kToAlaw8k(pcm: Buffer, state: ResampleState | null = null): Buffer {
  return pcm16ToAlaw(pcm16Downsample24kTo8k(pcm, state));
}

/** Convenience: µ-law 8 kHz → PCM16 24 kHz. */
export function mulaw8kToPcm16_24k(mulaw: Buffer): Buffer {
  return pcm16Upsample8kTo24k(mulawToPcm16(mulaw));
}

/** Convenience: PCM16 24 kHz → µ-law 8 kHz, with optional state for streaming. */
export function pcm16_24kToMulaw8k(
  pcm: Buffer,
  state: ResampleState | null = null,
): Buffer {
  return pcm16ToMulaw(pcm16Downsample24kTo8k(pcm, state));
}
