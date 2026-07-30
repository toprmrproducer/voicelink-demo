/**
 * Verifies the real VoicelinkProvider sends the right REST shapes.
 * No real Voicelink — we inject a fake fetch and assert what it received.
 */

import { describe, it, expect, vi } from "vitest";
import { VoicelinkProvider } from "../../../../src/adapters/telephony/voicelink/index.js";

function fakeJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("VoicelinkProvider — outbound", () => {
  it("POSTs the AddLeadRequest shape to /v1/add_lead", async () => {
    const fetchSpy = vi.fn(async () =>
      fakeJsonResponse(200, { unique_id: "vl-real-001" }),
    );
    const provider = new VoicelinkProvider({
      apiBase: "https://api.voicelink.test",
      bearerToken: "test-token",
      fetch: fetchSpy,
    });
    const handle = await provider.originateCall({
      fromDid: "+919999999999",
      toNumber: "+919876543210",
      countryCode: "91",
      customParameters: "campaign=7",
      websocketUrl: "wss://ws.auto4you.in/call/t1",
      webhookUrl: "https://api.auto4you.in/webhooks/voicelink",
      callLimit: 90,
    });
    expect(handle.providerCallId).toBe("vl-real-001");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.voicelink.test/v1/add_lead");
    expect((init as RequestInit).method).toBe("POST");
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("authorization")).toBe("Bearer test-token");
    expect(headers.get("content-type")).toBe("application/json");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toEqual({
      did_number: "+919999999999",
      customer_number: "+919876543210",
      country_code: "91",
      custom_parameters: "campaign=7",
      websocket_url: "wss://ws.auto4you.in/call/t1",
      webhook_url: "https://api.auto4you.in/webhooks/voicelink",
      call_limit: 90,
    });
  });

  it("omits optional fields when the input lacks them", async () => {
    const fetchSpy = vi.fn(async () =>
      fakeJsonResponse(200, { unique_id: "vl-real-002" }),
    );
    const provider = new VoicelinkProvider({
      apiBase: "https://api.voicelink.test",
      bearerToken: "test-token",
      fetch: fetchSpy,
    });
    await provider.originateCall({
      fromDid: "+919999999999",
      toNumber: "+919876543210",
    });
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      did_number: "+919999999999",
      customer_number: "+919876543210",
    });
  });

  it("accepts call_id when unique_id is absent (response shape variant)", async () => {
    const fetchSpy = vi.fn(async () =>
      fakeJsonResponse(200, { call_id: "vl-real-via-call-id" }),
    );
    const provider = new VoicelinkProvider({
      bearerToken: "x",
      fetch: fetchSpy,
    });
    const handle = await provider.originateCall({
      fromDid: "+91",
      toNumber: "+91",
    });
    expect(handle.providerCallId).toBe("vl-real-via-call-id");
  });

  it("accepts a wrapped { data: { unique_id } } envelope", async () => {
    const fetchSpy = vi.fn(async () =>
      fakeJsonResponse(200, { data: { unique_id: "vl-real-wrapped" } }),
    );
    const provider = new VoicelinkProvider({
      bearerToken: "x",
      fetch: fetchSpy,
    });
    const handle = await provider.originateCall({
      fromDid: "+91",
      toNumber: "+91",
    });
    expect(handle.providerCallId).toBe("vl-real-wrapped");
  });

  it("throws when Voicelink returns a non-2xx response", async () => {
    const fetchSpy = vi.fn(async () =>
      fakeJsonResponse(422, { message: "did_number invalid" }),
    );
    const provider = new VoicelinkProvider({
      bearerToken: "x",
      fetch: fetchSpy,
    });
    await expect(
      provider.originateCall({ fromDid: "+91", toNumber: "+91" }),
    ).rejects.toThrow(/422/);
  });

  it("throws when Voicelink returns 2xx but no id field", async () => {
    const fetchSpy = vi.fn(async () =>
      fakeJsonResponse(200, { ok: true /* but no id */ }),
    );
    const provider = new VoicelinkProvider({
      bearerToken: "x",
      fetch: fetchSpy,
    });
    await expect(
      provider.originateCall({ fromDid: "+91", toNumber: "+91" }),
    ).rejects.toThrow(/no unique_id/);
  });
});

describe("VoicelinkProvider — ws-bot registration", () => {
  it("POSTs the CreateWebsocketBotRequest shape", async () => {
    const fetchSpy = vi.fn(async () => fakeJsonResponse(201, { id: 42 }));
    const provider = new VoicelinkProvider({
      apiBase: "https://api.voicelink.test",
      bearerToken: "test-token",
      fetch: fetchSpy,
    });
    const handle = await provider.registerWebSocketBot({
      name: "tenant-1-bot",
      websocketUrl: "wss://ws.auto4you.in/call/tenant-1",
      webhookUrl: "https://api.auto4you.in/webhooks/voicelink",
      providerClientId: "12345",
      active: true,
    });
    expect(handle.providerBotId).toBe("42");

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.voicelink.test/v1/websocket-bot/create");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toEqual({
      bot_name: "tenant-1-bot",
      websocket_url: "wss://ws.auto4you.in/call/tenant-1",
      webhook_url: "https://api.auto4you.in/webhooks/voicelink",
      status: 1,
      client_id: 12345,
    });
  });

  it("rejects non-numeric providerClientId (Voicelink expects integer)", async () => {
    const fetchSpy = vi.fn();
    const provider = new VoicelinkProvider({
      bearerToken: "x",
      fetch: fetchSpy,
    });
    await expect(
      provider.registerWebSocketBot({
        name: "x",
        websocketUrl: "wss://x",
        providerClientId: "not-a-number",
      }),
    ).rejects.toThrow(/numeric/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends status=0 when active is explicitly false", async () => {
    const fetchSpy = vi.fn(async () => fakeJsonResponse(201, { id: 7 }));
    const provider = new VoicelinkProvider({
      bearerToken: "x",
      fetch: fetchSpy,
    });
    await provider.registerWebSocketBot({
      name: "x",
      websocketUrl: "wss://x",
      providerClientId: "100",
      active: false,
    });
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body.status).toBe(0);
  });
});

describe("VoicelinkProvider — bulk + factory", () => {
  it("bulkOriginate continues past a single-call failure", async () => {
    let n = 0;
    const fetchSpy = vi.fn(async () => {
      n += 1;
      if (n === 2) return fakeJsonResponse(500, { error: "boom" });
      return fakeJsonResponse(200, { unique_id: `vl-${n}` });
    });
    const provider = new VoicelinkProvider({
      bearerToken: "x",
      fetch: fetchSpy,
    });
    const handles = await provider.bulkOriginate(
      [
        { fromDid: "+91", toNumber: "+919876543210" },
        { fromDid: "+91", toNumber: "+919876543211" },
        { fromDid: "+91", toNumber: "+919876543212" },
      ],
      { pacingCallsPerSecond: 1000 },
    );
    // 3 attempted, 2 succeeded (1st and 3rd).
    expect(handles).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
