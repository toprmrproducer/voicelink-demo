/**
 * HTTP-fixture tests for the TTS providers.
 *
 * These don't hit the real vendor APIs — they swap in a fake `fetch`
 * implementation and assert on the request shape (URL, headers, body)
 * the provider emits, plus minimal behavior on responses (success +
 * error). Catches accidental regressions like a header rename, a
 * URL prefix flip, or a JSON field typo.
 *
 * Streaming is exercised by replaying a small ReadableStream of fixture
 * bytes through `streamTTS` and asserting the chunks that came out.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { ElevenLabsProvider } from "../../src/adapters/tts/elevenlabs.js";
import { CartesiaProvider } from "../../src/adapters/tts/cartesia.js";
import { PlayHTProvider } from "../../src/adapters/tts/playht.js";
import { TTSError } from "../../src/adapters/tts/types.js";

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: BodyInit | null | undefined;
}

const captured: CapturedRequest[] = [];
let nextResponse: () => Response = () =>
  new Response('{"voice_id":"vx"}', { status: 200, headers: { "content-type": "application/json" } });

const realFetch = globalThis.fetch;

beforeEach(() => {
  captured.length = 0;
  globalThis.fetch = vi.fn(async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL | Request).toString();
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h) {
      if (h instanceof Headers) {
        h.forEach((v, k) => (headers[k.toLowerCase()] = v));
      } else if (Array.isArray(h)) {
        for (const [k, v] of h) headers[k.toLowerCase()] = v;
      } else {
        for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v);
      }
    }
    captured.push({
      url,
      method: init?.method ?? "GET",
      headers,
      body: init?.body,
    });
    return nextResponse();
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.CARTESIA_API_KEY;
  delete process.env.PLAYHT_API_KEY;
  delete process.env.PLAYHT_USER_ID;
});

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (i < chunks.length) ctrl.enqueue(chunks[i++]);
      else ctrl.close();
    },
  });
}

// ────────────────── ElevenLabs ──────────────────

describe("ElevenLabsProvider", () => {
  beforeEach(() => {
    process.env.ELEVENLABS_API_KEY = "el-key";
  });

  it("cloneVoice POSTs to /v1/voices/add with xi-api-key + multipart body", async () => {
    nextResponse = () =>
      new Response('{"voice_id":"el-v-1"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const result = await new ElevenLabsProvider().cloneVoice({
      audioBuffer: Buffer.from("fake"),
      fileName: "sample.wav",
      name: "Test",
      language: "en",
    });
    expect(result.providerVoiceId).toBe("el-v-1");
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe("https://api.elevenlabs.io/v1/voices/add");
    expect(captured[0].method).toBe("POST");
    expect(captured[0].headers["xi-api-key"]).toBe("el-key");
    expect(captured[0].body).toBeInstanceOf(FormData);
  });

  it("streamTTS uses ulaw_8000 for telephony output", async () => {
    nextResponse = () =>
      new Response(streamFromChunks([new Uint8Array([1, 2, 3])]), { status: 200 });
    const chunks: string[] = [];
    await new Promise<void>((resolve, reject) => {
      void new ElevenLabsProvider().streamTTS({
        voiceId: "v-1",
        text: "hello",
        outputFormat: "telephony",
        onChunk: (b) => chunks.push(b),
        onDone: () => resolve(),
        onError: reject,
      });
    });
    expect(captured[0].url).toContain("/text-to-speech/v-1/stream");
    expect(captured[0].url).toContain("output_format=ulaw_8000");
    expect(captured[0].headers["content-type"]).toBe("application/json");
    const body = JSON.parse(captured[0].body as string);
    expect(body.text).toBe("hello");
    expect(body.model_id).toBe("eleven_turbo_v2_5");
    expect(chunks).toHaveLength(1);
  });

  it("streamTTS uses mp3_44100_128 for browser output", async () => {
    nextResponse = () =>
      new Response(streamFromChunks([new Uint8Array([0])]), { status: 200 });
    await new Promise<void>((resolve) => {
      void new ElevenLabsProvider().streamTTS({
        voiceId: "v-1",
        text: "hi",
        outputFormat: "browser",
        onChunk: () => {},
        onDone: () => resolve(),
        onError: () => resolve(),
      });
    });
    expect(captured[0].url).toContain("output_format=mp3_44100_128");
  });

  it("propagates a non-2xx error via TTSError", async () => {
    nextResponse = () =>
      new Response('{"error":"bad voice"}', { status: 400 });
    await expect(
      new ElevenLabsProvider().cloneVoice({
        audioBuffer: Buffer.from("a"),
        fileName: "x.wav",
        name: "X",
        language: "en",
      }),
    ).rejects.toBeInstanceOf(TTSError);
  });
});

// ────────────────── Cartesia ──────────────────

describe("CartesiaProvider", () => {
  beforeEach(() => {
    process.env.CARTESIA_API_KEY = "ct-key";
  });

  it("cloneVoice posts to /voices/clone with X-API-Key + Cartesia-Version", async () => {
    nextResponse = () =>
      new Response('{"id":"ct-v-1"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const result = await new CartesiaProvider().cloneVoice({
      audioBuffer: Buffer.from("a"),
      fileName: "s.wav",
      name: "Carto",
      language: "en",
      mode: "stability",
    });
    expect(result.providerVoiceId).toBe("ct-v-1");
    expect(captured[0].url).toBe("https://api.cartesia.ai/voices/clone");
    expect(captured[0].headers["x-api-key"]).toBe("ct-key");
    expect(captured[0].headers["cartesia-version"]).toBe("2024-11-13");
    expect(captured[0].body).toBeInstanceOf(FormData);
  });

  it("streamTTS sends the right output_format for telephony (pcm_mulaw 8000 raw)", async () => {
    // SSE response with one valid chunk event.
    const sseEvent =
      'data: {"type":"chunk","data":"YWJj"}\n\n'; // base64 "abc"
    nextResponse = () =>
      new Response(streamFromChunks([new TextEncoder().encode(sseEvent)]), {
        status: 200,
      });
    const chunks: string[] = [];
    await new Promise<void>((resolve, reject) => {
      void new CartesiaProvider().streamTTS({
        voiceId: "ct-v-1",
        text: "hello",
        outputFormat: "telephony",
        onChunk: (b) => chunks.push(b),
        onDone: () => resolve(),
        onError: reject,
      });
    });
    const body = JSON.parse(captured[0].body as string);
    expect(body.output_format).toEqual({
      container: "raw",
      encoding: "pcm_mulaw",
      sample_rate: 8000,
    });
    expect(body.voice).toEqual({ mode: "id", id: "ct-v-1" });
    expect(body.model_id).toBe("sonic-2");
    expect(chunks).toEqual(["YWJj"]);
  });

  it("streamTTS skips malformed SSE lines instead of erroring", async () => {
    const sseStream =
      'data: not-json\n\ndata: {"type":"chunk","data":"AAAA"}\n\n';
    nextResponse = () =>
      new Response(streamFromChunks([new TextEncoder().encode(sseStream)]), {
        status: 200,
      });
    const chunks: string[] = [];
    let errored = false;
    await new Promise<void>((resolve) => {
      void new CartesiaProvider().streamTTS({
        voiceId: "v",
        text: "x",
        onChunk: (b) => chunks.push(b),
        onDone: () => resolve(),
        onError: () => {
          errored = true;
          resolve();
        },
      });
    });
    expect(errored).toBe(false);
    expect(chunks).toEqual(["AAAA"]);
  });
});

// ────────────────── PlayHT ──────────────────

describe("PlayHTProvider", () => {
  beforeEach(() => {
    process.env.PLAYHT_USER_ID = "ph-user";
    process.env.PLAYHT_API_KEY = "ph-key";
  });

  it("cloneVoice posts to /cloned-voices/instant with both auth headers", async () => {
    nextResponse = () =>
      new Response('{"id":"ph-v-1"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const result = await new PlayHTProvider().cloneVoice({
      audioBuffer: Buffer.from("a"),
      fileName: "s.wav",
      name: "P",
      language: "en",
    });
    expect(result.providerVoiceId).toBe("ph-v-1");
    expect(captured[0].url).toBe(
      "https://api.play.ht/api/v2/cloned-voices/instant",
    );
    expect(captured[0].headers["x-user-id"]).toBe("ph-user");
    expect(captured[0].headers["authorization"]).toBe("ph-key");
  });

  it("streamTTS posts to /tts/stream with mulaw + sample_rate 8000 for telephony", async () => {
    nextResponse = () =>
      new Response(streamFromChunks([new Uint8Array([0xab, 0xcd])]), {
        status: 200,
      });
    const chunks: string[] = [];
    await new Promise<void>((resolve, reject) => {
      void new PlayHTProvider().streamTTS({
        voiceId: "v",
        text: "hi",
        outputFormat: "telephony",
        onChunk: (b) => chunks.push(b),
        onDone: () => resolve(),
        onError: reject,
      });
    });
    expect(captured[0].url).toBe("https://api.play.ht/api/v2/tts/stream");
    const body = JSON.parse(captured[0].body as string);
    expect(body.output_format).toBe("mulaw");
    expect(body.sample_rate).toBe(8000);
    expect(body.voice_engine).toBe("PlayDialog");
    expect(chunks).toHaveLength(1);
  });

  it("503-throws when keys are missing", async () => {
    delete process.env.PLAYHT_API_KEY;
    delete process.env.PLAYHT_USER_ID;
    await expect(
      new PlayHTProvider().cloneVoice({
        audioBuffer: Buffer.from("a"),
        fileName: "x.wav",
        name: "x",
        language: "en",
      }),
    ).rejects.toMatchObject({ status: 503, name: "TTSError" });
  });
});
