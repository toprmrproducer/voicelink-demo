/**
 * VoicelinkProvider — production-mode TelephonyProvider implementation.
 *
 * For v1 the real provider is structurally complete but UNTESTED against
 * Voicelink staging because the reseller API token (Q3), webhook signature
 * scheme (Q2), and WS audio wire protocol (Q1) are unresolved. Use the
 * VoicelinkMockProvider in `./__mock__.ts` for development and tests.
 *
 * The factory `createVoicelinkProvider()` reads VOICELINK_MODE from env:
 *   - "mock" (default): returns VoicelinkMockProvider
 *   - "live": returns VoicelinkProvider (real REST client)
 *
 * Switch to "live" once Voicelink team confirms Q1/Q2/Q3.
 */

import type { IncomingHttpHeaders } from "node:http";
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
import { VoicelinkClient } from "./client.js";
import { originateCall as voicelinkOriginate } from "./outbound.js";
import { registerWebSocketBot as voicelinkRegisterBot } from "./ws-bot.js";
import { verifyVoicelinkWebhook } from "./signature.js";
import {
  VoicelinkMockProvider,
  type VoicelinkMockOptions,
} from "./__mock__.js";

const log = createLogger("voicelink-provider");

export interface VoicelinkProviderOptions {
  apiBase?: string;
  bearerToken?: string;
  /** Inject a custom fetch (mainly for tests). */
  fetch?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
}

export class VoicelinkProvider implements TelephonyProvider {
  readonly name = "voicelink" as const;
  private readonly client: VoicelinkClient;

  constructor(opts: VoicelinkProviderOptions = {}) {
    this.client = new VoicelinkClient(opts);
  }

  originateCall(input: OutboundCallInput): Promise<CallHandle> {
    return voicelinkOriginate(this.client, input);
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
      try {
        handles.push(await this.originateCall(input));
      } catch (err) {
        log.error(
          { err, fromDid: input.fromDid, toNumber: input.toNumber },
          "bulk originate: single call failed; continuing",
        );
      }
      if (i < inputs.length - 1 && delayMs > 0) {
        await sleep(delayMs, opts?.signal);
      }
    }
    return handles;
  }

  registerWebSocketBot(input: WSBotInput): Promise<WSBotHandle> {
    return voicelinkRegisterBot(this.client, input);
  }

  async getCallStatus(_providerCallId: string): Promise<CallStatusInfo | null> {
    // Voicelink does not expose a per-call status REST endpoint in the
    // OpenAPI we have. v1 derives status from webhook events only.
    // Return null so callers fall back to the calls/call_events store.
    return null;
  }

  verifyWebhook(
    headers: IncomingHttpHeaders,
    rawBody: Buffer | string,
  ): boolean {
    return verifyVoicelinkWebhook(headers, rawBody, {
      secret: process.env.VOICELINK_WEBHOOK_SECRET,
      header: process.env.VOICELINK_WEBHOOK_HEADER,
    });
  }
}

/** Factory that picks the implementation based on VOICELINK_MODE env. */
export function createVoicelinkProvider(
  options: VoicelinkProviderOptions & VoicelinkMockOptions = {},
): TelephonyProvider {
  const mode = (process.env.VOICELINK_MODE ?? "mock").toLowerCase();
  if (mode === "live") {
    log.info("creating live VoicelinkProvider");
    return new VoicelinkProvider(options);
  }
  log.info("creating VoicelinkMockProvider (set VOICELINK_MODE=live to override)");
  return new VoicelinkMockProvider(options);
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

export { VoicelinkMockProvider } from "./__mock__.js";
