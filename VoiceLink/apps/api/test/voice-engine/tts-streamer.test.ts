import { describe, it, expect } from "vitest";

import { TTSStreamer, nextSentenceEnd } from "../../src/voice-engine/tts-streamer.js";
import type {
  TTSProvider,
  TTSStreamOptions,
  CloneVoiceResult,
  CloneVoiceParams,
} from "../../src/adapters/tts/types.js";

class FakeTTS implements TTSProvider {
  public synthesised: string[] = [];
  public aborted: number = 0;

  async cloneVoice(_p: CloneVoiceParams): Promise<CloneVoiceResult> {
    return { providerVoiceId: "fake-voice" };
  }

  async streamTTS(opts: TTSStreamOptions): Promise<void> {
    this.synthesised.push(opts.text);
    // Emulate a tiny streamed response.
    opts.onChunk(Buffer.from(opts.text).toString("base64"));
    if (opts.signal?.aborted) {
      this.aborted++;
      opts.onError(new Error("aborted"));
      return;
    }
    // Wait a beat so cancel() during synth can race.
    await new Promise((r) => setTimeout(r, 25));
    if (opts.signal?.aborted) {
      this.aborted++;
      return;
    }
    opts.onDone();
  }

  async deleteVoice(): Promise<void> {}
}

describe("nextSentenceEnd", () => {
  it("returns -1 for partial sentences", () => {
    expect(nextSentenceEnd("Hello there I am")).toBe(-1);
  });

  it("finds the period at end of a sentence", () => {
    expect(nextSentenceEnd("Hello.")).toBe(5);
  });

  it("treats ! and ? as terminators", () => {
    expect(nextSentenceEnd("Wow!")).toBe(3);
    expect(nextSentenceEnd("Is it?")).toBe(5);
  });

  it("does not split on abbreviations", () => {
    expect(nextSentenceEnd("Mr. Smith")).toBe(-1);
    expect(nextSentenceEnd("Dr. Smith says hello.")).toBe(20);
  });

  it("does not split on decimals", () => {
    expect(nextSentenceEnd("Price is 3.14 dollars")).toBe(-1);
    expect(nextSentenceEnd("Price is 3.14 dollars.")).toBe(21);
  });
});

describe("TTSStreamer", () => {
  it("synthesises each complete sentence as it arrives", async () => {
    const tts = new FakeTTS();
    const streamer = new TTSStreamer({
      provider: tts,
      voiceId: "v1",
      onChunk: () => {},
    });
    streamer.push("Hello there.");
    streamer.push(" How are you today?");
    streamer.push(" That's nice");
    // Wait for the queued synthesises to actually fire.
    await new Promise((r) => setTimeout(r, 60));
    expect(tts.synthesised).toEqual(["Hello there.", "How are you today?"]);
    streamer.flush();
    await new Promise((r) => setTimeout(r, 60));
    expect(tts.synthesised).toEqual([
      "Hello there.",
      "How are you today?",
      "That's nice",
    ]);
  });

  it("cancel() aborts in-flight synthesis and drops the buffer", async () => {
    const tts = new FakeTTS();
    const chunks: string[] = [];
    const streamer = new TTSStreamer({
      provider: tts,
      voiceId: "v1",
      onChunk: (c) => chunks.push(c),
    });
    streamer.push("First sentence.");
    streamer.cancel();
    await new Promise((r) => setTimeout(r, 60));
    // The synth had started (queued microtask), but signal was aborted
    // mid-flight; the abort count went up.
    expect(tts.aborted).toBeGreaterThanOrEqual(1);
    // No more synth on the next push.
    streamer.push(" Second sentence.");
    await new Promise((r) => setTimeout(r, 60));
    expect(tts.synthesised).toEqual(["First sentence."]);
  });
});
