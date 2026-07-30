import { describe, it, expect } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "node:net";

import { FakeRealtimeProvider } from "../../src/adapters/llm/fake.js";
import { CallSession } from "../../src/voice-engine/session-manager.js";
import {
  mulawDecodeSample,
  mulawEncodeSample,
  pcm16ToMulaw,
  mulawToPcm16,
  EnergyVAD,
} from "../../src/voice-engine/audio-pipeline.js";

describe("audio-pipeline mulaw round-trip", () => {
  it("decoded value is recoverable through encode/decode", () => {
    // mulaw has two encodings for 0 (0x7F = +0, 0xFF = -0), so exact byte
    // round-trip fails for those. The right invariant is: encode-decode
    // returns a value within mulaw's quantization step of the original.
    for (const mu of [0x00, 0x80, 0x42, 0xb0, 0x10, 0xe0]) {
      const v1 = mulawDecodeSample(mu);
      const muAgain = mulawEncodeSample(v1);
      const v2 = mulawDecodeSample(muAgain);
      expect(v2).toBe(v1);
    }
  });

  it("encoded sign matches the input sign", () => {
    expect(mulawEncodeSample(8000) & 0x80).toBe(0x80); // positive → sign clear after ~
    expect(mulawEncodeSample(-8000) & 0x80).toBe(0); // negative
  });

  it("buffer helpers preserve sample count and width", () => {
    const pcm = Buffer.alloc(20);
    for (let i = 0; i < 10; i++) pcm.writeInt16LE((i - 5) * 1000, i * 2);
    const mu = pcm16ToMulaw(pcm);
    expect(mu.length).toBe(10);
    const back = mulawToPcm16(mu);
    expect(back.length).toBe(20);
  });
});

describe("EnergyVAD", () => {
  it("fires once after sustained loud audio", () => {
    const vad = new EnergyVAD(500, 2);
    const loud = Buffer.alloc(160);
    for (let i = 0; i < 80; i++) loud.writeInt16LE(8000, i * 2);
    expect(vad.feed(loud)).toBe(false);
    expect(vad.feed(loud)).toBe(true);
    expect(vad.feed(loud)).toBe(false); // already tripped, doesn't fire again
  });

  it("resets the counter on quiet frames", () => {
    const vad = new EnergyVAD(500, 2);
    const loud = Buffer.alloc(160);
    for (let i = 0; i < 80; i++) loud.writeInt16LE(8000, i * 2);
    const quiet = Buffer.alloc(160);
    expect(vad.feed(loud)).toBe(false);
    expect(vad.feed(quiet)).toBe(false);
    expect(vad.feed(loud)).toBe(false);
    expect(vad.feed(loud)).toBe(true);
  });
});

describe("CallSession + FakeRealtimeProvider — echo bot", () => {
  it("pumps audio in -> provider -> audio out, end-to-end", async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;

    // The "telephony side" is a single WS connection; the session-manager
    // owns it and forwards to the provider.
    let session: CallSession | undefined;
    const provider = new FakeRealtimeProvider();
    server.once("connection", (telephonySocket) => {
      session = new CallSession(telephonySocket, {
        callId: "test-call",
        provider,
      });
      void session.start();
    });

    const caller = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      caller.once("open", resolve);
      caller.once("error", reject);
    });

    const received: Buffer[] = [];
    caller.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.event === "media" && msg.media?.payload) {
        received.push(Buffer.from(msg.media.payload, "base64"));
      }
    });

    const payload = Buffer.from([0x10, 0x20, 0x30, 0x40]);
    caller.send(
      JSON.stringify({
        event: "media",
        media: { payload: payload.toString("base64") },
      }),
    );

    // Allow the microtask queue + WS roundtrip to settle.
    await new Promise((r) => setTimeout(r, 50));

    expect(provider.inboundAudio).toHaveLength(1);
    expect(provider.inboundAudio[0].equals(payload)).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0].equals(payload)).toBe(true);

    caller.close();
    await session?.close();
    server.close();
  });
});
