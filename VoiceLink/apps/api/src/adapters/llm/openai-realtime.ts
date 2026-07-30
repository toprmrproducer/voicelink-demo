import WebSocket from "ws";

import { createLogger } from "../../lib/logger.js";
import type { RealtimeProvider, RealtimeProviderConfig } from "./types.js";

const log = createLogger("openai-realtime");

// Skeleton for the OpenAI Realtime WS API. Full event-shape wiring
// (input_audio_buffer.append, response.create, response.audio.delta,
// response.text.delta, response.done, error) lands when we have a real
// OPENAI_API_KEY in the prod env and can poke the live endpoint.
//
// For Phase 1, this connects + records intent. The echo-bot test uses
// FakeRealtimeProvider so we don't burn API credits in CI.
export class OpenAiRealtimeProvider implements RealtimeProvider {
  private ws?: WebSocket;
  private audioHandlers: ((frame: Buffer) => void)[] = [];
  private textHandlers: ((delta: string) => void)[] = [];
  private turnEndHandlers: (() => void)[] = [];
  private errorHandlers: ((err: Error) => void)[] = [];

  constructor(private cfg: RealtimeProviderConfig) {}

  async connect(): Promise<void> {
    const model = this.cfg.model || "gpt-4o-realtime-preview-2024-12-17";
    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });
    await new Promise<void>((resolve, reject) => {
      this.ws!.once("open", resolve);
      this.ws!.once("error", reject);
    });
    this.ws.on("message", (data) => this.handleMessage(data.toString()));
    this.ws.on("error", (err) => this.errorHandlers.forEach((h) => h(err as Error)));
    log.info({ model }, "openai realtime connected");
  }

  private handleMessage(raw: string): void {
    let msg: { type?: string; delta?: string; audio?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case "response.audio.delta":
        if (msg.audio) {
          const frame = Buffer.from(msg.audio, "base64");
          for (const h of this.audioHandlers) h(frame);
        }
        break;
      case "response.text.delta":
        if (msg.delta) for (const h of this.textHandlers) h(msg.delta);
        break;
      case "response.done":
        for (const h of this.turnEndHandlers) h();
        break;
      case "error":
        for (const h of this.errorHandlers) h(new Error(raw));
        break;
    }
  }

  sendAudio(frame: Buffer): void {
    this.ws?.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: frame.toString("base64"),
      }),
    );
  }

  sendText(text: string): void {
    this.ws?.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      }),
    );
    this.ws?.send(JSON.stringify({ type: "response.create" }));
  }

  onAudio(h: (frame: Buffer) => void) { this.audioHandlers.push(h); }
  onText(h: (delta: string) => void) { this.textHandlers.push(h); }
  onTurnEnd(h: () => void) { this.turnEndHandlers.push(h); }
  onError(h: (err: Error) => void) { this.errorHandlers.push(h); }

  /**
   * Cancel any in-flight response. Called when the caller interrupts
   * (Voicelink barge-in). OpenAI Realtime supports this via the
   * `response.cancel` client event — the model stops generating
   * mid-stream and any audio frames already buffered on our side
   * become stale (the session manager drops them).
   */
  cancel(): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "response.cancel" }));
  }

  async close(): Promise<void> {
    this.ws?.close();
  }
}
