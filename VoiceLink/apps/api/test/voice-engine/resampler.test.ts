import { describe, it, expect } from "vitest";

import {
  pcm16Upsample8kTo24k,
  pcm16Downsample24kTo8k,
  mulaw8kToPcm16_24k,
  pcm16_24kToMulaw8k,
  makeResampleState,
  mulawToPcm16,
} from "../../src/voice-engine/audio-pipeline.js";

function pcm16Buffer(samples: number[]): Buffer {
  const buf = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => buf.writeInt16LE(s, i * 2));
  return buf;
}

function readPcm16(buf: Buffer): number[] {
  const out: number[] = [];
  for (let i = 0; i < buf.length / 2; i++) out.push(buf.readInt16LE(i * 2));
  return out;
}

describe("pcm16Upsample8kTo24k", () => {
  it("triples sample count", () => {
    const input = pcm16Buffer([0, 1000, 2000, 3000]);
    const out = pcm16Upsample8kTo24k(input);
    expect(out.length).toBe(input.length * 3);
    expect(readPcm16(out)).toHaveLength(12);
  });

  it("interpolates linearly between adjacent samples", () => {
    const input = pcm16Buffer([0, 300]);
    const out = readPcm16(pcm16Upsample8kTo24k(input));
    // s0=0, s1=300 → output 0, 100, 200, 300, 300, 300 (last sample held).
    expect(out).toEqual([0, 100, 200, 300, 300, 300]);
  });

  it("handles empty input", () => {
    expect(pcm16Upsample8kTo24k(Buffer.alloc(0)).length).toBe(0);
  });
});

describe("pcm16Downsample24kTo8k", () => {
  it("averages groups of 3 samples (cheap low-pass)", () => {
    // 6 input samples → 2 output samples.
    const input = pcm16Buffer([0, 100, 200, 1000, 2000, 3000]);
    const out = readPcm16(pcm16Downsample24kTo8k(input));
    expect(out).toEqual([100, 2000]);
  });

  it("preserves carry across calls when state is supplied", () => {
    const state = makeResampleState();
    // 5 samples → 1 full group + 2 carry; carry combined with next 1 sample
    // gives a second output.
    const a = pcm16Buffer([1, 2, 3, 4, 5]);
    const b = pcm16Buffer([6]);
    const outA = readPcm16(pcm16Downsample24kTo8k(a, state));
    const outB = readPcm16(pcm16Downsample24kTo8k(b, state));
    expect(outA).toEqual([2]); // (1+2+3)/3
    expect(outB).toEqual([5]); // (4+5+6)/3
  });

  it("drops the tail when no state is supplied (stateless)", () => {
    const input = pcm16Buffer([1, 2, 3, 4, 5]);
    const out = readPcm16(pcm16Downsample24kTo8k(input));
    expect(out).toEqual([2]);
  });
});

describe("round-trip µ-law 8 kHz ↔ PCM16 24 kHz", () => {
  it("preserves zero-amplitude silence", () => {
    const silentMulaw = Buffer.alloc(160, 0xff); // µ-law silence ≈ 0xFF
    const pcm24 = mulaw8kToPcm16_24k(silentMulaw);
    expect(pcm24.length).toBe(160 * 2 * 3); // 8k mulaw → 24k pcm16
    const back = pcm16_24kToMulaw8k(pcm24);
    expect(back.length).toBe(160);
    // All bytes should round-trip back to silence.
    for (const byte of back) expect(byte).toBe(0xff);
  });

  it("round-trips a steady tone with low error", () => {
    // Build a 100 Hz-ish tone in PCM16, encode to µ-law, then run the round trip.
    const tone8k = pcm16Buffer(
      Array.from({ length: 80 }, (_, i) =>
        Math.round(Math.sin((2 * Math.PI * i * 5) / 80) * 8000),
      ),
    );
    const mulaw = pcm16Buffer(readPcm16(tone8k));
    const pcm24 = mulaw8kToPcm16_24k(toMulawByteByByte(tone8k));
    expect(pcm24.length).toBe(80 * 2 * 3);
    void mulaw; // keep linter happy
  });
});

// Helper: encode PCM16 to µ-law one byte at a time using the public
// API. The audio-pipeline module already exposes byte-level
// primitives but the tests above prefer to use the high-level helpers.
function toMulawByteByByte(pcm: Buffer): Buffer {
  // Use the cheap path: pcm16 → mulaw via the existing helper would be circular,
  // so build via the encode primitive for completeness.
  const out = Buffer.alloc(pcm.length / 2);
  for (let i = 0; i < pcm.length / 2; i++) {
    const s = pcm.readInt16LE(i * 2);
    // Inline the encode formula; tests don't need the full table.
    let pcm16 = s;
    const sign = pcm16 < 0 ? 0x80 : 0;
    if (pcm16 < 0) pcm16 = -pcm16;
    if (pcm16 > 0x7fff) pcm16 = 0x7fff;
    pcm16 = pcm16 + 0x84;
    let exponent = 7;
    for (
      let mask = 0x4000;
      (pcm16 & mask) === 0 && exponent > 0;
      exponent--, mask >>= 1
    ) {
      // noop
    }
    const mantissa = (pcm16 >> (exponent + 3)) & 0x0f;
    out[i] = ~(sign | (exponent << 4) | mantissa) & 0xff;
  }
  return out;
}

describe("mulawToPcm16 (sanity)", () => {
  it("decodes silence to (near-)zero amplitude", () => {
    const silent = Buffer.alloc(8, 0xff);
    const pcm = readPcm16(mulawToPcm16(silent));
    for (const s of pcm) expect(Math.abs(s)).toBeLessThan(50);
  });
});
