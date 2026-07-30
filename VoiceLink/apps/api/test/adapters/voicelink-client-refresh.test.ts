/**
 * VoicelinkClient — token-refresh fallback.
 *
 * The client should:
 *   1. Use the configured bearer on every request.
 *   2. On 401, if username+password are set: log in, cache the new
 *      bearer, retry the original request once with it.
 *   3. Not loop infinitely if the retry also 401s.
 *   4. De-dupe concurrent refreshes via a single-flight guard.
 *   5. Skip the refresh path entirely when creds are missing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { VoicelinkClient } from "../../src/adapters/telephony/voicelink/client.js";

interface CapturedRequest {
  url: string;
  method: string;
  authHeader?: string;
  body?: string;
}

function makeFetchMock(handlers: ((req: CapturedRequest) => Response)[]): {
  fetch: typeof fetch;
  captured: CapturedRequest[];
} {
  const captured: CapturedRequest[] = [];
  let i = 0;
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as URL | Request).toString();
    const headers = new Headers(init?.headers);
    captured.push({
      url,
      method: init?.method ?? "GET",
      authHeader: headers.get("authorization") ?? undefined,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    if (i >= handlers.length) {
      throw new Error(`fetch called more times than expected (i=${i})`);
    }
    return handlers[i++](captured[captured.length - 1]);
  }) as unknown as typeof fetch;
  return { fetch, captured };
}

beforeEach(() => {
  delete process.env.VOICELINK_API_BASE;
  delete process.env.VOICELINK_RESELLER_TOKEN;
  delete process.env.VOICELINK_RESELLER_USERNAME;
  delete process.env.VOICELINK_RESELLER_PASSWORD;
});

describe("VoicelinkClient.request", () => {
  it("uses the configured bearer token on the first attempt", async () => {
    const { fetch, captured } = makeFetchMock([
      () => new Response('{"ok":true}', { status: 200 }),
    ]);
    const client = new VoicelinkClient({
      apiBase: "https://api.example.com",
      bearerToken: "primary-token",
      fetch,
    });
    await client.request("POST", "/v1/add_lead", { x: 1 });
    expect(captured).toHaveLength(1);
    expect(captured[0].authHeader).toBe("Bearer primary-token");
  });

  it("refreshes and retries once on 401 when creds are set", async () => {
    const { fetch, captured } = makeFetchMock([
      // 1. First request — 401 with stale token.
      () => new Response('{"error":"unauthorized"}', { status: 401 }),
      // 2. Login request.
      () =>
        new Response(
          JSON.stringify({
            status: true,
            data: { access_token: "fresh-token", token_type: "Bearer" },
          }),
          { status: 200 },
        ),
      // 3. Retry of the original request — should use fresh-token.
      () => new Response('{"ok":true}', { status: 200 }),
    ]);
    const client = new VoicelinkClient({
      apiBase: "https://api.example.com",
      bearerToken: "stale-token",
      username: "Hardikk",
      password: "shh",
      fetch,
    });

    const result = await client.request<{ ok: boolean }>("GET", "/v1/somewhere");
    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(3);

    // First request: stale token.
    expect(captured[0].url).toBe("https://api.example.com/v1/somewhere");
    expect(captured[0].authHeader).toBe("Bearer stale-token");

    // Login: no auth header, body has username + password.
    expect(captured[1].url).toBe("https://api.example.com/v1/auth/login");
    expect(captured[1].method).toBe("POST");
    expect(captured[1].authHeader).toBeUndefined();
    const loginBody = JSON.parse(captured[1].body ?? "{}");
    expect(loginBody.username).toBe("Hardikk");
    expect(loginBody.password).toBe("shh");

    // Retry: fresh token.
    expect(captured[2].url).toBe("https://api.example.com/v1/somewhere");
    expect(captured[2].authHeader).toBe("Bearer fresh-token");
  });

  it("does not retry a second time if the refreshed call also 401s", async () => {
    const { fetch, captured } = makeFetchMock([
      // 1. First request — 401.
      () => new Response("{}", { status: 401 }),
      // 2. Login OK.
      () =>
        new Response(
          JSON.stringify({ status: true, data: { access_token: "fresh" } }),
          { status: 200 },
        ),
      // 3. Retry — also 401. Must NOT trigger another login.
      () => new Response("{}", { status: 401 }),
    ]);
    const client = new VoicelinkClient({
      apiBase: "https://api.example.com",
      bearerToken: "stale",
      username: "u",
      password: "p",
      fetch,
    });

    await expect(client.request("GET", "/x")).rejects.toMatchObject({ status: 401 });
    expect(captured).toHaveLength(3); // No fourth attempt.
  });

  it("does not refresh when username/password are missing", async () => {
    const { fetch, captured } = makeFetchMock([
      () => new Response('{"error":"x"}', { status: 401 }),
    ]);
    const client = new VoicelinkClient({
      apiBase: "https://api.example.com",
      bearerToken: "stale",
      fetch,
    });
    await expect(client.request("GET", "/x")).rejects.toMatchObject({ status: 401 });
    expect(captured).toHaveLength(1); // No login attempt.
  });

  it("propagates the next subsequent request with the new cached bearer", async () => {
    const { fetch, captured } = makeFetchMock([
      // 1. First call hits 401.
      () => new Response("{}", { status: 401 }),
      // 2. Login.
      () =>
        new Response(
          JSON.stringify({ status: true, data: { access_token: "fresh" } }),
          { status: 200 },
        ),
      // 3. Retry of first call — succeeds.
      () => new Response('{"ok":1}', { status: 200 }),
      // 4. Second, completely separate call — should use the cached fresh token, no second login.
      () => new Response('{"ok":2}', { status: 200 }),
    ]);
    const client = new VoicelinkClient({
      apiBase: "https://api.example.com",
      bearerToken: "stale",
      username: "u",
      password: "p",
      fetch,
    });

    await client.request("GET", "/first");
    await client.request("GET", "/second");

    expect(captured).toHaveLength(4);
    expect(captured[3].authHeader).toBe("Bearer fresh"); // No second /auth/login.
    expect(captured[3].url).toBe("https://api.example.com/second");
  });

  it("de-dupes concurrent refreshes via single-flight", async () => {
    let loginCalls = 0;
    let resolveLogin: ((r: Response) => void) | null = null;
    const loginPromise = new Promise<Response>((resolve) => {
      resolveLogin = resolve;
    });

    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/v1/auth/login")) {
        loginCalls++;
        return await loginPromise;
      }
      const headers = new Headers(init?.headers);
      const auth = headers.get("authorization");
      if (auth === "Bearer stale") {
        return new Response("{}", { status: 401 });
      }
      if (auth === "Bearer fresh") {
        return new Response(`{"path":"${url}","method":"${method}"}`, { status: 200 });
      }
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;

    const client = new VoicelinkClient({
      apiBase: "https://api.example.com",
      bearerToken: "stale",
      username: "u",
      password: "p",
      fetch,
    });

    // Fire two concurrent requests; both will 401 and trigger a refresh.
    const p1 = client.request("GET", "/a");
    const p2 = client.request("GET", "/b");

    // Give the event loop a tick so both 401s land before we resolve login.
    await new Promise((r) => setTimeout(r, 5));

    // Resolve the single in-flight login.
    resolveLogin!(
      new Response(
        JSON.stringify({ status: true, data: { access_token: "fresh" } }),
        { status: 200 },
      ),
    );

    await p1;
    await p2;
    expect(loginCalls).toBe(1); // Single-flight worked.
  });
});
