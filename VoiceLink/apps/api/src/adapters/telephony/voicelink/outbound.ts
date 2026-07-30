/**
 * Voicelink outbound dialer — wraps POST /v1/add_lead.
 *
 * NOT YET tested against the real Voicelink staging because the reseller
 * API token (Q3) is unresolved. The request shape matches the OpenAPI
 * AddLeadRequest schema verbatim.
 */

import type { CallHandle, OutboundCallInput } from "../types.js";
import type { VoicelinkClient } from "./client.js";

interface AddLeadRequest {
  did_number: string;
  customer_number: string;
  country_code?: string;
  custom_parameters?: string;
  websocket_url?: string;
  webhook_url?: string;
  call_limit?: number;
}

interface AddLeadResponse {
  /** Voicelink's stable id for this call. */
  unique_id?: string;
  /** Some endpoints return `call_id` instead. */
  call_id?: string;
  /** Generic data envelope; some Voicelink endpoints wrap responses. */
  data?: {
    unique_id?: string;
    call_id?: string;
    /** Live VoiceLink returns the queued-call id here (verified 2026-06-15). */
    outbound_queue_id?: number | string;
  };
}

/**
 * VoiceLink's carrier rejects a full E.164 customer_number (e.g. the
 * 12-digit "919307512816") with cause "38 - Network out of order". It
 * needs the NATIONAL number plus a separate country_code. Verified live
 * 2026-06-15: "9307512816" + country_code "91" connects; "919307512816"
 * fails. Normalize Indian numbers here so every outbound path is correct.
 */
function normalizeIndia(toNumber: string, countryCode?: string): {
  customer_number: string;
  country_code?: string;
} {
  const digits = toNumber.replace(/[^0-9]/g, "");
  if (!countryCode && digits.length === 12 && digits.startsWith("91")) {
    return { customer_number: digits.slice(2), country_code: "91" };
  }
  if (!countryCode && digits.length === 10) {
    return { customer_number: digits, country_code: "91" };
  }
  return { customer_number: toNumber, ...(countryCode ? { country_code: countryCode } : {}) };
}

export async function originateCall(
  client: VoicelinkClient,
  input: OutboundCallInput,
): Promise<CallHandle> {
  const norm = normalizeIndia(input.toNumber, input.countryCode);
  const body: AddLeadRequest = {
    did_number: input.fromDid,
    customer_number: norm.customer_number,
  };
  if (norm.country_code !== undefined) body.country_code = norm.country_code;
  if (input.customParameters !== undefined)
    body.custom_parameters = input.customParameters;
  if (input.websocketUrl !== undefined) body.websocket_url = input.websocketUrl;
  if (input.webhookUrl !== undefined) body.webhook_url = input.webhookUrl;
  if (input.callLimit !== undefined) body.call_limit = input.callLimit;

  const res = await client.request<AddLeadResponse>("POST", "/v1/add_lead", body);
  const rawId =
    res.unique_id ??
    res.call_id ??
    res.data?.unique_id ??
    res.data?.call_id ??
    res.data?.outbound_queue_id;
  if (rawId === undefined || rawId === null) {
    throw new Error(
      `add_lead succeeded but no call id in response: ${JSON.stringify(res)}`,
    );
  }
  return { providerCallId: String(rawId), acceptedAt: new Date() };
}
