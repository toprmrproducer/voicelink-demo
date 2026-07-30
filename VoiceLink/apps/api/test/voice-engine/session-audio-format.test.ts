/**
 * CallSession audio-format bridging.
 *
 * In `passthrough` mode (the default), bytes flow verbatim in both
 * directions. This is what FakeRealtimeProvider expects and the echo-
 * bot test relies on.
 *
 * In `mulaw8k-pcm16_24k` mode (production telephony):
 *   - Inbound:  µ-law 8 kHz (40 bytes/frame typical) gets converted to
 *               PCM16 24 kHz (240 bytes/frame) before sendAudio.
 *   - Outbound: PCM16 24 kHz from provider.onAudio gets converted to
 *               µ-law 8 kHz (1/6 the byte count) before going on the WS.
 *               Outbound conversion is stateful so frames concatenate
 *               cleanly without dropping samples.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

import { CallSession } from "../../src/voice-engine/session-manager.js";
import {
  pcm16Upsample8kTo24k,
  mulawToPcm16,
} from "../../src/voice-engine/audio-pipeline.js";
import type { RealtimeProvider } from "../../src/adapters/llm/types.js";

// ────── test fakes ──────

class FakeWebSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.emit("close");
  }
}

interface FakeProvider extends RealtimeProvider {
  __audioReceived: Buffer[];
  __emitAudioFromProvider(frame: Buffer): void;
}

function makeProvider(): FakeProvider {
  const audioReceived: Buffer[] = [];
  let onAudioCb: ((f: Buffer) => void) | undefined;
  const provider: FakeProvider = {
    async connect() {},
    sendAudio(frame: Buffer) {
      audioReceived.push(frame);
    },
    sendText() {},
    onAudio(cb) {
      onAudioCb = cb;
    },
    onText() {},
    onTurnEnd() {},
    onError() {},
    async close() {},
    __audioReceived: audioReceived,
    __emitAudioFromProvider(frame: Buffer) {
      onAudioCb?.(frame);
    },
  };
  return provider;
}

beforeEach(() => {
  vi.useRealTimers();
});

// ────── tests ──────

describe("CallSession passthrough mode (default)", () => {
  it("forwards inbound media bytes verbatim to provider.sendAudio", async () => {
    const socket = new FakeWebSocket();
    const provider = makeProvider();
    const session = new CallSession(socket as unknown as WebSocket, {
      callId: "c1",
      provider,
    });
    await session.start();

    const raw = Buffer.from([1, 2, 3, 4]);
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          event: "media",
          media: { payload: raw.toString("base64") },
        }),
      ),
    );

    expect(provider.__audioReceived).toHaveLength(1);
    expect(provider.__audioReceived[0]).toEqual(raw);
  });

  it("forwards outbound provider audio verbatim to the WS", async () => {
    const socket = new FakeWebSocket();
    const provider = makeProvider();
    const session = new CallSession(socket as unknown as WebSocket, {
      callId: "c1",
      provider,
    });
    await session.start();

    const frame = Buffer.from([0xaa, 0xbb, 0xcc]);
    provider.__emitAudioFromProvider(frame);

    expect(socket.sent).toHaveLength(1);
    const env = JSON.parse(socket.sent[0]);
    expect(env.event).toBe("media");
    expect(Buffer.from(env.media.payload, "base64")).toEqual(frame);
  });
});

describe("CallSession mulaw8k-pcm16_24k mode", () => {
  it("upsamples inbound µ-law 8 kHz to PCM16 24 kHz before sending to provider", async () => {
    const socket = new FakeWebSocket();
    const provider = makeProvider();
    const session = new CallSession(socket as unknown as WebSocket, {
      callId: "c1",
      provider,
      audioFormat: "mulaw8k-pcm16_24k",
    });
    await session.start();

    // 40 bytes µ-law → 80 bytes PCM16 8 kHz → 240 bytes PCM16 24 kHz.
    const mulawFrame = Buffer.alloc(40, 0xff); // mu-law silence
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          event: "media",
          media: { payload: mulawFrame.toString("base64") },
        }),
      ),
    );

    expect(provider.__audioReceived).toHaveLength(1);
    const sent = provider.__audioReceived[0];
    expect(sent.length).toBe(40 * 2 * 3); // 240 bytes

    // Sanity: matches the direct conversion.
    const expected = pcm16Upsample8kTo24k(mulawToPcm16(mulawFrame));
    expect(sent).toEqual(expected);
  });

  it("downsamples outbound PCM16 24 kHz to µ-law 8 kHz before sending on WS", async () => {
    const socket = new FakeWebSocket();
    const provider = makeProvider();
    const session = new CallSession(socket as unknown as WebSocket, {
      callId: "c1",
      provider,
      audioFormat: "mulaw8k-pcm16_24k",
    });
    await session.start();

    // 60 PCM16 samples at 24 kHz = 120 bytes → 20 PCM16 samples at 8 kHz
    // = 40 bytes PCM16 → 20 bytes µ-law.
    const pcm24 = Buffer.alloc(60 * 2);
    for (let i = 0; i < 60; i++) pcm24.writeInt16LE(0, i * 2); // silence
    provider.__emitAudioFromProvider(pcm24);

    expect(socket.sent).toHaveLength(1);
    const env = JSON.parse(socket.sent[0]);
    const wire = Buffer.from(env.media.payload, "base64");
    expect(wire.length).toBe(20); // 60 / 3 PCM16 samples → 20 µ-law bytes
  });

  it("preserves resampler state across multiple outbound frames (no sample drop)", async () => {
    const socket = new FakeWebSocket();
    const provider = makeProvider();
    const session = new CallSession(socket as unknown as WebSocket, {
      callId: "c1",
      provider,
      audioFormat: "mulaw8k-pcm16_24k",
    });
    await session.start();

    // First frame: 5 samples at 24 kHz. With state, 1 group of 3 is
    // consumed, the remaining 2 carry over.
    const frame1 = Buffer.alloc(5 * 2);
    for (let i = 0; i < 5; i++) frame1.writeInt16LE(0, i * 2);
    provider.__emitAudioFromProvider(frame1);

    // Second frame: 1 sample. Together with the 2-sample carry, makes
    // a full group of 3 → another 1 µ-law byte out.
    const frame2 = Buffer.alloc(1 * 2);
    frame2.writeInt16LE(0, 0);
    provider.__emitAudioFromProvider(frame2);

    // 2 sends, total of 2 µ-law samples (1 from each).
    expect(socket.sent).toHaveLength(2);
    const wire1 = Buffer.from(JSON.parse(socket.sent[0]).media.payload, "base64");
    const wire2 = Buffer.from(JSON.parse(socket.sent[1]).media.payload, "base64");
    expect(wire1.length).toBe(1); // (3 of 5 samples) → 1 µ-law byte
    expect(wire2.length).toBe(1); // (carry 2 + new 1 = 3 samples) → 1 µ-law byte
  });
});

// Re-export for typing
type WebSocket = import("ws").WebSocket;
