/**
 * In-process Voicelink mock that satisfies TelephonyProvider.
 *
 * Used to develop and test the rest of the platform (campaign engine,
 * call lifecycle, billing) before Voicelink Q1/Q2/Q3 are resolved and the
 * real client is wired up. Behavior mirrors the OpenAPI spec shape.
 *
 * Beyond TelephonyProvider, the mock exposes test-only "simulate*"
 * methods so integration tests can drive the call-event webhook receiver
 * end-to-end without standing up a real Voicelink instance.
 */

import type { IncomingHttpHeaders } from "node:http";
import {
  VoicelinkCallEvent as VoicelinkCallEventSchema,
  type VoicelinkCallEvent,
  type VoicelinkEventType,
} from "@voiceplatform/shared";

import { createLogger } from "../../../lib/logger.js";
import type {
  BulkOriginateOptions,
  CallHandle,
  CallStatusInfo,
  OutboundCallInput,
  TelephonyProvider,
  WSBotHandle,
  WSBotInput,
} from "../types.js";

const log = createLogger("voicelink-mock");

/** What the mock records per originate call. */
interface MockCallRecord {
  providerCallId: string;
  fromDid: string;
  toNumber: string;
  acceptedAt: Date;
  status: CallStatusInfo["status"];
  durationSec?: number;
  answerDurationSec?: number;
  recordingUrl?: string;
}

/** Configuration for VoicelinkMockProvider. */
export interface VoicelinkMockOptions {
  /**
   * URL that simulateCallEvent() will POST to. Typically
   * `http://localhost:<api-port>/webhooks/voicelink`. If omitted,
   * simulateCallEvent buffers events instead of POSTing.
   */
  webhookSinkUrl?: string;
  /** Override the prefix used for synthetic providerCallId. */
  callIdPrefix?: string;
  /** Override the prefix used for synthetic providerBotId. */
  botIdPrefix?: string;
  /** Inject a custom fetch (defaults to globalThis.fetch). */
  fetch?: typeof fetch;
}

export class VoicelinkMockProvider implements TelephonyProvider {
  readonly name = "voicelink" as const;
  private callCounter = 0;
  private botCounter = 0;
  private readonly calls = new Map<string, MockCallRecord>();
  private readonly bots = new Map<string, WSBotHandle>();
  private readonly bufferedEvents: VoicelinkCallEvent[] = [];

  constructor(private readonly opts: VoicelinkMockOptions = {}) {
    log.warn(
      "voicelink mock provider active — signature verification disabled",
    );
  }

  async originateCall(input: OutboundCallInput): Promise<CallHandle> {
    const providerCallId = this.nextCallId();
    const acceptedAt = new Date();
    this.calls.set(providerCallId, {
      providerCallId,
      fromDid: input.fromDid,
      toNumber: input.toNumber,
      acceptedAt,
      status: "ringing",
    });
    return { providerCallId, acceptedAt };
  }

  async bulkOriginate(
    inputs: OutboundCallInput[],
    opts?: BulkOriginateOptions,
  ): Promise<CallHandle[]> {
    const rate = opts?.pacingCallsPerSecond ?? 1;
    const delayMs = Math.max(0, Math.floor(1000 / Math.max(rate, 0.01)));
    const handles: CallHandle[] = [];
    for (let i = 0; i < inputs.length; i++) {
      if (opts?.signal?.aborted) break;
      const input = inputs[i]!;
      handles.push(await this.originateCall(input));
      if (i < inputs.length - 1 && delayMs > 0) {
        await sleep(delayMs, opts?.signal);
      }
    }
    return handles;
  }

  async registerWebSocketBot(input: WSBotInput): Promise<WSBotHandle> {
    const providerBotId = this.nextBotId();
    const handle: WSBotHandle = {
      providerBotId,
      websocketUrl: input.websocketUrl,
      active: input.active ?? true,
    };
    this.bots.set(providerBotId, handle);
    return handle;
  }

  async getCallStatus(
    providerCallId: string,
  ): Promise<CallStatusInfo | null> {
    const record = this.calls.get(providerCallId);
    if (!record) return null;
    return {
      providerCallId,
      status: record.status,
      answerDurationSec: record.answerDurationSec,
      durationSec: record.durationSec,
      recordingUrl: record.recordingUrl,
    };
  }

  verifyWebhook(
    _headers: IncomingHttpHeaders,
    _rawBody: Buffer | string,
  ): boolean {
    // The mock never rejects. Real provider must implement HMAC (Q2).
    return true;
  }

  // ────────── test-only helpers ──────────

  /** Snapshot the in-memory call ledger (for assertions). */
  listCalls(): MockCallRecord[] {
    return [...this.calls.values()];
  }

  /** Snapshot the in-memory bot registry (for assertions). */
  listBots(): WSBotHandle[] {
    return [...this.bots.values()];
  }

  /** Buffered events, used when webhookSinkUrl is not configured. */
  drainBufferedEvents(): VoicelinkCallEvent[] {
    return this.bufferedEvents.splice(0, this.bufferedEvents.length);
  }

  /**
   * Build and fire (or buffer) a single call-event webhook. Updates
   * the in-memory call status when applicable.
   *
   * @param providerCallId  id returned from a prior originateCall()
   * @param patch           partial event fields. unique_id / call_id /
   *                        virtual_number / customer_number are inferred
   *                        from the stored call record.
   */
  async simulateCallEvent(
    providerCallId: string,
    patch: SimulateEventPatch,
  ): Promise<VoicelinkCallEvent> {
    const record = this.calls.get(providerCallId);
    if (!record) {
      throw new Error(
        `unknown providerCallId ${providerCallId} — call originateCall first`,
      );
    }
    const event: VoicelinkCallEvent = VoicelinkCallEventSchema.parse({
      event_type: patch.event_type,
      unique_id: providerCallId,
      call_id: providerCallId,
      customer_number: record.toNumber,
      virtual_number: record.fromDid,
      agent_number: patch.agent_number ?? null,
      call_type: "outbound",
      call_date: (patch.call_date ?? new Date().toISOString()),
      duration: patch.duration ?? record.durationSec,
      answer_duration: patch.answer_duration ?? record.answerDurationSec,
      status: patch.status,
      recording_path: patch.recording_path ?? record.recordingUrl ?? "",
      hangup_cause: patch.hangup_cause ?? "",
    });

    // Update in-memory state. Mirrors voicelinkToCallStatus from the
    // shared schema so the mock's view matches what the webhook receiver
    // would persist for the same event.
    record.status = mapEventToStatus(event.event_type, event.status);
    if (event.duration !== undefined) record.durationSec = event.duration;
    if (event.answer_duration !== undefined) {
      record.answerDurationSec = event.answer_duration;
    }
    if (event.recording_path !== undefined) {
      record.recordingUrl = event.recording_path;
    }

    if (this.opts.webhookSinkUrl) {
      const fetchImpl = this.opts.fetch ?? globalThis.fetch;
      const res = await fetchImpl(this.opts.webhookSinkUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      });
      if (!res.ok) {
        throw new Error(
          `webhook sink ${this.opts.webhookSinkUrl} returned ${res.status}`,
        );
      }
    } else {
      this.bufferedEvents.push(event);
    }

    return event;
  }

  /**
   * Fire ringing → answered → completed in sequence. Useful for
   * end-to-end tests that want to drive a full call lifecycle.
   */
  async simulateFullCallLifecycle(
    providerCallId: string,
    opts: { answerDurationSec?: number; recordingUrl?: string } = {},
  ): Promise<VoicelinkCallEvent[]> {
    const events: VoicelinkCallEvent[] = [];
    events.push(
      await this.simulateCallEvent(providerCallId, {
        event_type: "ringing",
        status: "answered", // not terminal yet
      }),
    );
    events.push(
      await this.simulateCallEvent(providerCallId, {
        event_type: "answered",
        status: "answered",
      }),
    );
    const dur = opts.answerDurationSec ?? 30;
    events.push(
      await this.simulateCallEvent(providerCallId, {
        event_type: "completed",
        status: "answered",
        duration: dur + 5,
        answer_duration: dur,
        recording_path: opts.recordingUrl ?? "",
        hangup_cause: "normal_clearing",
      }),
    );
    return events;
  }

  /** Simulate a "no answer" / "busy" / "failed" outcome. */
  async simulateFailedCall(
    providerCallId: string,
    reason: "busy" | "noanswer" | "failed" = "noanswer",
  ): Promise<VoicelinkCallEvent[]> {
    const events: VoicelinkCallEvent[] = [];
    events.push(
      await this.simulateCallEvent(providerCallId, {
        event_type: "ringing",
        status: "answered",
      }),
    );
    events.push(
      await this.simulateCallEvent(providerCallId, {
        event_type: "completed",
        status: reason,
        duration: 0,
        answer_duration: 0,
        hangup_cause: reason,
      }),
    );
    return events;
  }

  // ────────── internal ──────────

  private nextCallId(): string {
    this.callCounter += 1;
    const prefix = this.opts.callIdPrefix ?? "vl-mock-call";
    return `${prefix}-${this.callCounter.toString().padStart(6, "0")}`;
  }
  private nextBotId(): string {
    this.botCounter += 1;
    const prefix = this.opts.botIdPrefix ?? "vl-mock-bot";
    return `${prefix}-${this.botCounter.toString().padStart(4, "0")}`;
  }
}

/** Partial event fields that simulateCallEvent accepts. */
export interface SimulateEventPatch {
  event_type: VoicelinkEventType;
  status: "answered" | "busy" | "noanswer" | "failed";
  agent_number?: string | null;
  call_date?: string;
  duration?: number;
  answer_duration?: number;
  recording_path?: string;
  hangup_cause?: string;
}

function mapEventToStatus(
  event_type: VoicelinkEventType,
  status: "answered" | "busy" | "noanswer" | "failed",
): CallStatusInfo["status"] {
  if (event_type === "ringing") return "ringing";
  if (event_type === "answered") return "answered";
  if (event_type === "completed") {
    return status === "answered" ? "completed" : "failed";
  }
  return "failed";
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
