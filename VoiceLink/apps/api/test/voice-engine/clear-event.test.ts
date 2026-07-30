/**
 * Voicelink barge-in: when the customer interrupts, Voicelink fires
 * `{event:"clear"}` on the WS. The session must:
 *
 *   1. Call provider.cancel() so the model stops generating.
 *   2. Reset the outbound resampler so any tail samples from the
 *      cancelled response don't leak into the next turn's frames.
 *   3. Continue serving — clear should NOT close the WS.
 */

import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";

import { CallSession } from "../../src/voice-engine/session-manager.js";
import type { RealtimeProvider } from "../../src/adapters/llm/types.js";

class FakeWebSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  closed = false;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.emit("close");
  }
}

interface CancelTrackingProvider extends RealtimeProvider {
  cancelCount: number;
  __emitAudio(frame: Buffer): void;
}

function makeProvider(): CancelTrackingProvider {
  let onAudioCb: ((f: Buffer) => void) | undefined;
  return {
    async connect() {},
    sendAudio() {},
    sendText() {},
    onAudio(cb) {
      onAudioCb = cb;
    },
    onText() {},
    onTurnEnd() {},
    onError() {},
    cancelCount: 0,
    cancel() {
      this.cancelCount += 1;
    },
    async close() {},
    __emitAudio(frame: Buffer) {
      onAudioCb?.(frame);
    },
  };
}

describe("CallSession — Voicelink clear (barge-in)", () => {
  it("calls provider.cancel() when the WS sends an event:clear frame", async () => {
    const socket = new FakeWebSocket();
    const provider = makeProvider();
    const session = new CallSession(socket as unknown as WebSocket, {
      callId: "c1",
      provider,
      audioFormat: "mulaw8k-pcm16_24k",
    });
    await session.start();

    socket.emit("message", Buffer.from(JSON.stringify({ event: "clear" })));

    expect(provider.cancelCount).toBe(1);
    expect(socket.closed).toBe(false); // clear must NOT close the WS
  });

  it("does not close the session on clear (call continues)", async () => {
    const socket = new FakeWebSocket();
    const provider = makeProvider();
    const session = new CallSession(socket as unknown as WebSocket, {
      callId: "c1",
      provider,
    });
    await session.start();

    socket.emit("message", Buffer.from(JSON.stringify({ event: "clear" })));
    socket.emit("message", Buffer.from(JSON.stringify({ event: "clear" })));
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          event: "media",
          media: { payload: Buffer.from("hi").toString("base64") },
        }),
      ),
    );

    // Three clears + media, socket is still open.
    expect(socket.closed).toBe(false);
    expect(provider.cancelCount).toBe(2);
  });

  it("resets the outbound resampler so post-clear frames don't carry stale samples", async () => {
    const socket = new FakeWebSocket();
    const provider = makeProvider();
    const session = new CallSession(socket as unknown as WebSocket, {
      callId: "c1",
      provider,
      audioFormat: "mulaw8k-pcm16_24k",
    });
    await session.start();

    // Pre-clear: emit a frame of 2 PCM16 samples (24 kHz). 2 samples
    // is not enough to make a group of 3 → 0 µ-law bytes out, but the
    // 2 samples are stashed as carry.
    const twoSamples = Buffer.alloc(2 * 2);
    provider.__emitAudio(twoSamples);
    expect(socket.sent).toHaveLength(0);

    // Customer interrupts.
    socket.emit("message", Buffer.from(JSON.stringify({ event: "clear" })));
    expect(provider.cancelCount).toBe(1);

    // Post-clear: emit a frame of 1 sample. Without the reset, this
    // would combine with the stashed 2 carry samples → 1 µ-law byte
    // would emerge. WITH the reset, the 1 sample alone isn't enough
    // → 0 bytes emitted. That's the contract: no leakage from the
    // cancelled response into the new one.
    const oneSample = Buffer.alloc(1 * 2);
    provider.__emitAudio(oneSample);
    expect(socket.sent).toHaveLength(0);
  });

  it("no-ops cleanly when the provider does not implement cancel()", async () => {
    const socket = new FakeWebSocket();
    // Provider without cancel().
    const minimalProvider: RealtimeProvider = {
      async connect() {},
      sendAudio() {},
      sendText() {},
      onAudio() {},
      onText() {},
      onTurnEnd() {},
      onError() {},
      async close() {},
    };
    const session = new CallSession(socket as unknown as WebSocket, {
      callId: "c1",
      provider: minimalProvider,
    });
    await session.start();

    expect(() => {
      socket.emit("message", Buffer.from(JSON.stringify({ event: "clear" })));
    }).not.toThrow();
  });
});

type WebSocket = import("ws").WebSocket;
