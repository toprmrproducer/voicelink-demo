/**
 * Thin HTTP client for the Voicelink REST API.
 *
 * Authentication is Sanctum Bearer. The platform stays on a primary
 * token (env VOICELINK_RESELLER_TOKEN). When that token returns 401 —
 * either expired or rotated in the Voicelink portal — the client
 * automatically logs in via /v1/auth/login (when
 * VOICELINK_RESELLER_USERNAME + VOICELINK_RESELLER_PASSWORD are set),
 * caches the new bearer in memory, and retries the original request
 * once. This means a token rotation in Voicelink's UI doesn't require
 * an api restart on our side.
 *
 * Tests inject `fetch` to mock HTTP without touching the network.
 */

import { createLogger } from "../../../lib/logger.js";

const log = createLogger("voicelink-client");

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface VoicelinkClientOptions {
  /** Defaults to env VOICELINK_API_BASE or https://app.voicelink.co.in/api */
  apiBase?: string;
  /** Defaults to env VOICELINK_RESELLER_TOKEN */
  bearerToken?: string;
  /** Defaults to env VOICELINK_RESELLER_USERNAME */
  username?: string;
  /** Defaults to env VOICELINK_RESELLER_PASSWORD */
  password?: string;
  /** Inject a custom fetch (defaults to globalThis.fetch) */
  fetch?: FetchLike;
  /** Per-request timeout in ms (default 15000) */
  timeoutMs?: number;
}

export interface VoicelinkApiError extends Error {
  status: number;
  body?: unknown;
}

const DEFAULT_API_BASE = "https://app.voicelink.co.in/api";

interface LoginResponse {
  status: boolean;
  message?: string;
  data?: {
    access_token?: string;
    token_type?: string;
  };
}

export class VoicelinkClient {
  private readonly apiBase: string;
  /** Mutable: starts at the env token, gets refreshed on 401 if creds are set. */
  private bearerToken: string;
  private readonly username: string | undefined;
  private readonly password: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  /** Single-flight guard so concurrent 401s don't all log in at once. */
  private refreshInFlight: Promise<string> | null = null;

  constructor(opts: VoicelinkClientOptions = {}) {
    this.apiBase = (opts.apiBase ?? process.env.VOICELINK_API_BASE ?? DEFAULT_API_BASE)
      .replace(/\/+$/, "");
    this.bearerToken = opts.bearerToken ?? process.env.VOICELINK_RESELLER_TOKEN ?? "";
    this.username = opts.username ?? process.env.VOICELINK_RESELLER_USERNAME ?? undefined;
    this.password = opts.password ?? process.env.VOICELINK_RESELLER_PASSWORD ?? undefined;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    if (!this.bearerToken && !(this.username && this.password)) {
      log.warn(
        "Voicelink auth not configured: set VOICELINK_RESELLER_TOKEN or VOICELINK_RESELLER_USERNAME+PASSWORD",
      );
    }
  }

  /** Low-level request helper. Auto-retries once on 401 if creds are set. */
  async request<T = unknown>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
    opts: { _retry?: boolean } = {},
  ): Promise<T> {
    const url = `${this.apiBase}${path.startsWith("/") ? path : `/${path}`}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const init: RequestInit = {
        method,
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${this.bearerToken}`,
        },
        signal: controller.signal,
      };
      if (body !== undefined) init.body = JSON.stringify(body);

      const res = await this.fetchImpl(url, init);
      const text = await res.text();
      let parsed: unknown = undefined;
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }

      // 401 + we have credentials + this isn't already a retry → refresh and retry once.
      if (res.status === 401 && !opts._retry && this.username && this.password) {
        log.warn(
          { method, path },
          "Voicelink returned 401 — refreshing bearer and retrying once",
        );
        await this.refreshBearer();
        return this.request<T>(method, path, body, { _retry: true });
      }

      if (!res.ok) {
        const err = new Error(
          `Voicelink ${method} ${path} → ${res.status}`,
        ) as VoicelinkApiError;
        err.status = res.status;
        err.body = parsed;
        throw err;
      }
      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Log in to /v1/auth/login and update the cached bearer. Concurrent
   * callers share a single in-flight request via `refreshInFlight`.
   */
  private async refreshBearer(): Promise<string> {
    if (!this.username || !this.password) {
      throw new Error("refreshBearer called without username + password");
    }
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = (async () => {
      try {
        const url = `${this.apiBase}/v1/auth/login`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const res = await this.fetchImpl(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify({
              username: this.username,
              password: this.password,
            }),
            signal: controller.signal,
          });
          if (!res.ok) {
            throw new Error(`Voicelink /v1/auth/login → ${res.status}`);
          }
          const json = (await res.json()) as LoginResponse;
          const newToken = json.data?.access_token;
          if (!newToken) {
            throw new Error(
              `Voicelink login response missing data.access_token: ${JSON.stringify(json)}`,
            );
          }
          this.bearerToken = newToken;
          log.info("Voicelink bearer refreshed via /v1/auth/login");
          return newToken;
        } finally {
          clearTimeout(timer);
        }
      } finally {
        this.refreshInFlight = null;
      }
    })();
    return this.refreshInFlight;
  }
}
