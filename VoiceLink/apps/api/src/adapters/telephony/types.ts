/**
 * Provider-agnostic telephony interface.
 *
 * v1 surface: just what we need to ship the first paying call. Tenant /
 * DID / wallet provisioning is intentionally absent because Hardik does
 * that in Voicelink's own admin UI (see Architecture.md §2).
 *
 * Additional methods (createClient, listAvailableNumbers, allocateWallet,
 * etc.) will be added as we automate more of the reseller flow.
 */

import type { IncomingHttpHeaders } from "node:http";

export type TelephonyProviderName = "voicelink" | "fonada";

/** What we ask the provider to dial. */
export interface OutboundCallInput {
  /** DID rented from the provider that places the call. */
  fromDid: string;
  /** Customer phone number to dial, E.164 preferred. */
  toNumber: string;
  /** Optional E.164 country code override. */
  countryCode?: string;
  /**
   * Free-form metadata the provider will round-trip back to us in the
   * call-event webhook (Voicelink: `custom_parameters` field).
   * Stringified — providers accept ≤255 chars.
   */
  customParameters?: string;
  /**
   * Optional per-call override of the WS bot URL the provider should
   * connect to when the call answers. Defaults to the bot registered on
   * the DID.
   */
  websocketUrl?: string;
  /**
   * Optional per-call webhook URL override for status callbacks.
   */
  webhookUrl?: string;
  /** Max call duration in seconds (Voicelink: `call_limit`). */
  callLimit?: number;
}

/** Handle returned after a successful originate request. */
export interface CallHandle {
  /** Provider-assigned call id (Voicelink: `unique_id`). */
  providerCallId: string;
  /** When the provider accepted the originate request. */
  acceptedAt: Date;
}

/** Bulk-originate pacing options. */
export interface BulkOriginateOptions {
  /** Calls per second. Defaults to 1 (safe). */
  pacingCallsPerSecond?: number;
  /** AbortSignal to stop in-flight bulk dispatch. */
  signal?: AbortSignal;
}

/** WebSocket bot registration input. */
export interface WSBotInput {
  /** Display name. */
  name: string;
  /** Our WS URL the provider should connect to (wss://ws.auto4you.in/...). */
  websocketUrl: string;
  /** Optional status-callback webhook URL. */
  webhookUrl?: string;
  /** Provider client (tenant) id the bot belongs to. */
  providerClientId: string;
  /** Active by default. */
  active?: boolean;
}

/** Handle returned after WS bot creation/update. */
export interface WSBotHandle {
  /** Provider-assigned bot id. */
  providerBotId: string;
  /** Echo of registered URL. */
  websocketUrl: string;
  /** Whether the bot is active. */
  active: boolean;
}

/** Minimal status snapshot for a call. */
export interface CallStatusInfo {
  providerCallId: string;
  status: "ringing" | "answered" | "completed" | "failed" | "unknown";
  /** Seconds of talk time (post-answer). */
  answerDurationSec?: number;
  /** Total seconds including ringing. */
  durationSec?: number;
  /** Recording URL if available. */
  recordingUrl?: string;
}

export interface TelephonyProvider {
  readonly name: TelephonyProviderName;

  /**
   * Dial a single outbound call. Returns when the provider has accepted
   * the request — actual ringing/answer events arrive via webhook + WS.
   */
  originateCall(input: OutboundCallInput): Promise<CallHandle>;

  /**
   * Dial many calls with per-second pacing. Honors AbortSignal.
   * The default implementation calls `originateCall` in a loop; providers
   * with native bulk endpoints can override.
   */
  bulkOriginate(
    inputs: OutboundCallInput[],
    opts?: BulkOriginateOptions,
  ): Promise<CallHandle[]>;

  /** Register a new WebSocket bot URL with the provider. */
  registerWebSocketBot(input: WSBotInput): Promise<WSBotHandle>;

  /** Pull a status snapshot for a call. Returns null if the call is unknown. */
  getCallStatus(providerCallId: string): Promise<CallStatusInfo | null>;

  /**
   * Verify that a webhook POST is genuinely from this provider.
   *
   * For Voicelink v1 the signature scheme is unknown (Q2) — implementers
   * MAY return `true` after logging a warning; production deploys SHOULD
   * gate webhook access via an IP allow-list at Caddy until the scheme
   * is confirmed.
   */
  verifyWebhook(
    headers: IncomingHttpHeaders,
    rawBody: Buffer | string,
  ): boolean;
}
