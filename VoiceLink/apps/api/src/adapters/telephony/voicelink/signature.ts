/**
 * Voicelink webhook signature verification.
 *
 * Q2 (signature scheme) is still unresolved — this module ships the
 * most likely scheme (HMAC-SHA256 over the raw body, hex-encoded, in a
 * dedicated header) so the moment Voicelink confirms, we flip the env
 * vars on VPS-1 and verification turns on with no code change.
 *
 * Behavior matrix:
 *   - VOICELINK_WEBHOOK_SECRET unset → log a one-time warning, return
 *     true. This is the current production stance: we gate at Caddy
 *     by source-IP allow-list and accept every request the proxy lets
 *     through. Suitable for mock / staging.
 *   - VOICELINK_WEBHOOK_SECRET set, header missing → return false
 *     (fail closed). The proxy let the request through but the body
 *     is unsigned — almost certainly a misconfiguration, never trust it.
 *   - VOICELINK_WEBHOOK_SECRET set, header present, HMAC matches →
 *     return true.
 *   - VOICELINK_WEBHOOK_SECRET set, header present, HMAC mismatches →
 *     return false.
 *
 * The header name defaults to `X-Voicelink-Signature` and the format
 * to `<hex>` or `hmac-sha256=<hex>` (both accepted). If Voicelink ships
 * something different, override via VOICELINK_WEBHOOK_HEADER and (if
 * the algorithm differs) extend the parser below.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import { createLogger } from "../../../lib/logger.js";

const log = createLogger("voicelink-sig");

const DEFAULT_HEADER = "x-voicelink-signature";

let warnedNoSecret = false;

export interface VerifyOptions {
  /** HMAC secret. Read from VOICELINK_WEBHOOK_SECRET in production. */
  secret?: string;
  /** Header name (case-insensitive). Defaults to X-Voicelink-Signature. */
  header?: string;
}

/**
 * Verify the signature on a Voicelink webhook POST.
 *
 * @param headers Express `req.headers` — keys are already lower-cased.
 * @param rawBody The exact bytes Voicelink signed. Use the raw body
 *                captured by the express.json `verify` hook in
 *                `server.ts`, NOT a re-serialized JSON.stringify of
 *                the parsed object (the order/whitespace will differ).
 */
export function verifyVoicelinkWebhook(
  headers: IncomingHttpHeaders,
  rawBody: Buffer | string,
  opts: VerifyOptions = {},
): boolean {
  const secret = opts.secret ?? "";
  if (!secret) {
    if (!warnedNoSecret) {
      log.warn(
        "VOICELINK_WEBHOOK_SECRET unset — webhook signatures are NOT verified (Q2 unresolved)",
      );
      warnedNoSecret = true;
    }
    return true;
  }

  const headerName = (opts.header ?? DEFAULT_HEADER).toLowerCase();
  const provided = pickHeader(headers, headerName);
  if (!provided) {
    log.warn({ header: headerName }, "secret configured but signature header missing — rejecting");
    return false;
  }

  const expectedHex = createHmac("sha256", secret).update(toBuffer(rawBody)).digest("hex");
  const providedHex = parseSignature(provided);
  if (!providedHex) {
    log.warn({ provided: provided.slice(0, 12) + "..." }, "could not parse signature header");
    return false;
  }
  return safeHexEqual(expectedHex, providedHex);
}

function pickHeader(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const v = headers[name];
  if (Array.isArray(v)) return v[0];
  return v;
}

/**
 * Accept either a bare hex string or an `algo=<hex>` form. We don't
 * branch on the algorithm name today — if Voicelink ever ships
 * something other than HMAC-SHA256 we'll add a switch here.
 */
function parseSignature(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (/^[a-f0-9]+$/i.test(trimmed)) return trimmed.toLowerCase();
  const eq = trimmed.indexOf("=");
  if (eq === -1) return undefined;
  const value = trimmed.slice(eq + 1).trim();
  return /^[a-f0-9]+$/i.test(value) ? value.toLowerCase() : undefined;
}

function safeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

function toBuffer(body: Buffer | string): Buffer {
  return typeof body === "string" ? Buffer.from(body, "utf8") : body;
}

/** Reset the one-shot warning. Tests use this between cases. */
export function __resetSignatureWarningForTests(): void {
  warnedNoSecret = false;
}
