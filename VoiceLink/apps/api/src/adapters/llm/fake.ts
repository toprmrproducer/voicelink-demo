import type { RealtimeProvider, RealtimeProviderConfig } from "./types.js";

/**
 * In-memory provider for tests. Echoes any text sent to it and emits a
 * synthetic audio frame of the same byte length, then signals turn end.
 */
export class FakeRealtimeProvider implements RealtimeProvider {
  private audioHandlers: ((frame: Buffer) => void)[] = [];
  private textHandlers: ((delta: string) => void)[] = [];
  private turnEndHandlers: (() => void)[] = [];
  private errorHandlers: ((err: Error) => void)[] = [];
  private connected = false;

  // Public so tests can assert what was sent.
  public readonly inboundAudio: Buffer[] = [];
  public readonly inboundText: string[] = [];

  constructor(_cfg: Partial<RealtimeProviderConfig> = {}) {}

  async connect(): Promise<void> {
    this.connected = true;
  }

  sendAudio(frame: Buffer): void {
    if (!this.connected) throw new Error("not connected");
    this.inboundAudio.push(frame);
    // Echo back as a single audio frame.
    queueMicrotask(() => {
      for (const h of this.audioHandlers) h(Buffer.from(frame));
      for (const h of this.turnEndHandlers) h();
    });
  }

  sendText(text: string): void {
    if (!this.connected) throw new Error("not connected");
    this.inboundText.push(text);
    queueMicrotask(() => {
      for (const h of this.textHandlers) h(text);
      for (const h of this.turnEndHandlers) h();
    });
  }

  onAudio(handler: (frame: Buffer) => void): void {
    this.audioHandlers.push(handler);
  }
  onText(handler: (delta: string) => void): void {
    this.textHandlers.push(handler);
  }
  onTurnEnd(handler: () => void): void {
    this.turnEndHandlers.push(handler);
  }
  onError(handler: (err: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  // Test seam — let tests trigger an error for the error-path branch.
  emitError(err: Error): void {
    for (const h of this.errorHandlers) h(err);
  }

  /** Test seam — count cancel() invocations from session-manager. */
  public cancelCount = 0;
  cancel(): void {
    this.cancelCount += 1;
  }

  async close(): Promise<void> {
    this.connected = false;
  }
}
