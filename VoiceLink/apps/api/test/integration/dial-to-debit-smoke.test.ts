/**
 * End-to-end smoke harness for the full dial-to-debit pipeline.
 *
 * Proves the streams shipped in Phase 1 + Phase 2 actually wire together:
 *   campaign-engine.dialNextLead (P2-B)
 *     → telephony.VoicelinkMockProvider.originateCall (S1)
 *     → ws-router upgrade on /ws/voicelink/:didId?callId=… (P2-F)
 *     → session-manager.CallSession.start with FakeRealtimeProvider (S2)
 *     → /webhooks/voicelink × 3 (ringing → answered → completed) (S1 + P2-A)
 *     → credits.debitForCall on the terminal event (P2-G)
 *
 * Everything below the test is direct DB seeding to keep the test focused
 * on the integration story instead of re-exercising every CRUD route's
 * happy path (those are unit-tested elsewhere).
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import WebSocket from "ws";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";

import { createApp } from "../../src/server.js";
import { connectDb, closeDb, getDb } from "../../src/db/connection.js";
import { mountCallWsRouter } from "../../src/voice-engine/ws-router.js";
import { FakeRealtimeProvider } from "../../src/adapters/llm/fake.js";
import { topUp } from "../../src/credits/ledger.js";

process.env.JWT_SECRET = "test-secret-must-be-at-least-16-chars-long";
process.env.BYOK_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
// Force the dial-now route to construct VoicelinkMockProvider (no real HTTP).
process.env.VOICELINK_MODE = "mock";

import { signAuthToken } from "../../src/lib/jwt.js";

let mongo: MongoMemoryServer;
let httpServer: http.Server;
let baseUrl: string;
let wsBaseUrl: string;
let lastFakeProvider: FakeRealtimeProvider | undefined;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri(), "voiceplatform-smoke");

  const app = createApp();
  httpServer = http.createServer(app);

  // Inject a fake realtime provider into ws-router so session-manager
  // can start without OPENAI_API_KEY. Capture each instance so we can
  // assert on the one used by the test call.
  mountCallWsRouter(httpServer, {
    realtimeFactory: () => {
      const provider = new FakeRealtimeProvider();
      lastFakeProvider = provider;
      return provider;
    },
  });

  await new Promise<void>((resolve) =>
    httpServer.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  wsBaseUrl = `ws://127.0.0.1:${port}`;

  // The campaign engine reads this to build the per-call WS URL it gives
  // to Voicelink (here: the mock provider). Setting it here makes the
  // smoke flow round-trip through the actual ws-router we mounted.
  process.env.WS_BASE_URL = wsBaseUrl;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await closeDb();
  await mongo.stop();
  delete process.env.WS_BASE_URL;
});

beforeEach(async () => {
  for (const c of [
    "users",
    "tenants",
    "agents",
    "dids",
    "campaigns",
    "calls",
    "call_events",
    "credits",
    "credits_ledger",
    "did_logs",
  ]) {
    await getDb().collection(c).deleteMany({});
  }
  lastFakeProvider = undefined;
});

/** Seed exactly enough to exercise the dial path. */
async function seedWorld(): Promise<{
  tenantId: string;
  agentId: string;
  didId: string;
  providerNumber: string;
  tenantToken: string;
}> {
  const db = getDb();
  const tenantId = new ObjectId().toString();
  const agentId = new ObjectId().toString();
  const didId = new ObjectId().toString();
  const providerNumber = "+919999999900";
  const now = new Date();

  await db.collection("tenants").insertOne({
    _id: tenantId,
    name: "SmokeCo",
    plan: "starter",
    status: "active",
    telephony: {
      provider: "voicelink",
      providerClientId: 99001,
      walletThresholdNotify: 0,
    },
    createdAt: now,
    updatedAt: now,
  });

  await db.collection("agents").insertOne({
    _id: agentId,
    tenantId,
    name: "Smoke Agent",
    prompt: "You answer with one short sentence.",
    voice: { provider: "openai-realtime", providerVoiceId: "alloy" },
    llm: { realtimeModel: "gpt-4o-mini-realtime", temperature: 0.7 },
    tools: [],
    greeting: "Hello — smoke test calling.",
    endCallTriggers: [],
    status: "published",
    createdAt: now,
    updatedAt: now,
  });

  await db.collection("dids").insertOne({
    _id: didId,
    tenantId,
    provider: "voicelink",
    providerNumber,
    didType: "mobile",
    defaultAgentId: agentId,
    status: "active",
    assignedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  const userId = new ObjectId().toString();
  await db.collection("users").insertOne({
    _id: userId,
    email: "owner@smoke.example.com",
    passwordHash: "irrelevant",
    role: "owner",
    isSuperadmin: false,
    tenantId,
    createdAt: now,
    updatedAt: now,
  });

  // Real credit balance via the actual ledger function so the topup
  // entry shows up in credits_ledger like a production write would.
  await topUp({ tenantId, amount: 200, note: "smoke seed" });

  const tenantToken = signAuthToken({
    sub: userId,
    tenantId,
    role: "owner",
    isSuperadmin: false,
  });

  return { tenantId, agentId, didId, providerNumber, tenantToken };
}

function callEventPayload(
  providerCallId: string,
  customerNumber: string,
  virtualNumber: string,
  agentId: string,
  campaignId: string,
  internalCallId: string,
  patch: {
    event_type: "ringing" | "answered" | "completed" | "failed";
    status: "answered" | "busy" | "noanswer" | "failed";
    duration?: number;
    answer_duration?: number;
  },
): Record<string, unknown> {
  return {
    event_type: patch.event_type,
    unique_id: providerCallId,
    call_id: providerCallId,
    customer_number: customerNumber,
    virtual_number: virtualNumber,
    agent_number: null,
    call_type: "outbound",
    call_date: new Date().toISOString(),
    duration: patch.duration ?? 0,
    answer_duration: patch.answer_duration ?? 0,
    status: patch.status,
    recording_path:
      patch.event_type === "completed"
        ? "https://recordings.example/smoke.mp3"
        : "",
    hangup_cause: patch.event_type === "completed" ? "normal_clearing" : "",
    custom_parameters: JSON.stringify({
      callId: internalCallId,
      campaignId,
      agentId,
      tenantId: "ignored-by-resolver-uses-DID-instead",
    }),
  };
}

describe("dial-to-debit smoke harness", () => {
  it("dial → WS → webhooks → ledger debit, all consistent", async () => {
    const { tenantId, agentId, didId, providerNumber, tenantToken } =
      await seedWorld();

    // ── 1. Create a running campaign with one number ──────────────────
    const customerNumber = "+919876543210";
    const campaignId = new ObjectId().toString();
    const now = new Date();
    await getDb().collection("campaigns").insertOne({
      _id: campaignId,
      tenantId,
      agentId,
      fromDid: providerNumber,
      name: "Smoke campaign",
      numbers: [{ phone: customerNumber }],
      status: "running",
      stats: { total: 1, dialed: 0, connected: 0, succeeded: 0, failed: 0 },
      cursor: 0,
      schedule: {
        startAt: now,
        timezone: "Asia/Kolkata",
        pacingCallsPerMinute: 60,
        retries: 0,
      },
      createdAt: now,
      updatedAt: now,
    });

    // ── 2. Dial → exercises campaign-engine + telephony.mock ──────────
    const dialRes = await request(baseUrl)
      .post(`/campaigns/${campaignId}/dial-now`)
      .set("Authorization", `Bearer ${tenantToken}`)
      .expect(200);

    expect(dialRes.body.status).toBe("dialed");
    const internalCallId: string = dialRes.body.callId;
    expect(internalCallId).toBeDefined();

    const callRow = await getDb()
      .collection("calls")
      .findOne({ _id: internalCallId });
    expect(callRow).not.toBeNull();
    expect(callRow?.tenantId).toBe(tenantId);
    expect(callRow?.agentId).toBe(agentId);
    expect(callRow?.campaignId).toBe(campaignId);
    expect(callRow?.status).toBe("ringing");
    expect(callRow?.fromNumber).toBe(providerNumber);
    expect(callRow?.toNumber).toBe(customerNumber);
    const providerCallId: string = callRow!.providerCallId;
    expect(providerCallId).toMatch(/^vl-mock-call-/);

    // ── 3. Provider dials our WS endpoint with the per-call URL ──────
    // The campaign-engine built ws://…/ws/voicelink/<didId>?callId=<internalCallId>
    // and passed it to the mock as `websocketUrl`. The mock doesn't
    // actually open the socket — we open it from the test to simulate
    // Voicelink connecting to us.
    const wsUrl = `${wsBaseUrl}/ws/voicelink/${didId}?callId=${internalCallId}`;
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    // Outbound path → session.start() runs the greeting immediately via
    // realtimeForAgent. By the time the open event fires the factory
    // has been called.
    expect(lastFakeProvider).toBeDefined();

    // Send a single fake audio frame — exercises sendAudio path.
    const frame = Buffer.from([0x80, 0x80, 0x80, 0x80]);
    ws.send(JSON.stringify({ event: "media", media: { payload: frame.toString("base64") } }));

    // Hold the socket open briefly so session-manager has a chance to
    // process the frame, then close from our side cleanly.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await new Promise<void>((resolve) => {
      ws.once("close", () => resolve());
      ws.close(1000, "smoke test done");
    });

    // ── 4. Voicelink fires the call-event lifecycle webhooks ─────────
    const events = [
      {
        event_type: "ringing" as const,
        status: "answered" as const,
      },
      {
        event_type: "answered" as const,
        status: "answered" as const,
      },
      {
        event_type: "completed" as const,
        status: "answered" as const,
        duration: 35,
        answer_duration: 30,
      },
    ];
    for (const patch of events) {
      await request(baseUrl)
        .post("/webhooks/voicelink")
        .send(
          callEventPayload(
            providerCallId,
            customerNumber,
            providerNumber,
            agentId,
            campaignId,
            internalCallId,
            patch,
          ),
        )
        .expect(200);
    }

    // ── 5. Assert the full pipeline reached consistency ──────────────
    const db = getDb();

    const finalCall = await db
      .collection("calls")
      .findOne({ providerCallId });
    expect(finalCall).not.toBeNull();
    expect(finalCall?.status).toBe("completed");
    expect(finalCall?.durationSec).toBe(35);
    // P2-G backfills costCredits = round(durationSec * CREDIT_RATE_PER_SEC=1)
    expect(finalCall?.costCredits).toBe(35);
    // Tenant and agent stayed correct across all 3 webhook updates.
    expect(finalCall?.tenantId).toBe(tenantId);
    expect(finalCall?.agentId).toBe(agentId);
    expect(finalCall?.campaignId).toBe(campaignId);

    const eventRows = await db
      .collection("call_events")
      .find({ providerCallId })
      .toArray();
    expect(eventRows).toHaveLength(3);
    expect(eventRows.map((r) => r.eventType).sort()).toEqual(
      ["answered", "completed", "ringing"].sort(),
    );

    // Ledger: 1 topup from seed + 1 "call" debit from the completed webhook.
    const ledger = await db
      .collection("credits_ledger")
      .find({ tenantId })
      .sort({ createdAt: 1 })
      .toArray();
    expect(ledger).toHaveLength(2);
    expect(ledger[0]?.type).toBe("topup");
    expect(ledger[0]?.amount).toBe(200);
    expect(ledger[1]?.type).toBe("call");
    expect(ledger[1]?.amount).toBe(-35);
    expect(ledger[1]?.callId).toBe(providerCallId);

    const credits = await db
      .collection("credits")
      .findOne({ tenantId });
    expect(credits?.balance).toBe(200 - 35);
  });

  it("redelivered completed webhook does not double-debit (idempotent)", async () => {
    const { tenantId, agentId, didId, providerNumber, tenantToken } =
      await seedWorld();
    const customerNumber = "+919876543211";
    const campaignId = new ObjectId().toString();
    const now = new Date();
    await getDb().collection("campaigns").insertOne({
      _id: campaignId,
      tenantId,
      agentId,
      fromDid: providerNumber,
      name: "Idempotent smoke",
      numbers: [{ phone: customerNumber }],
      status: "running",
      stats: { total: 1, dialed: 0, connected: 0, succeeded: 0, failed: 0 },
      cursor: 0,
      schedule: {
        startAt: now,
        timezone: "Asia/Kolkata",
        pacingCallsPerMinute: 60,
        retries: 0,
      },
      createdAt: now,
      updatedAt: now,
    });

    const dialRes = await request(baseUrl)
      .post(`/campaigns/${campaignId}/dial-now`)
      .set("Authorization", `Bearer ${tenantToken}`)
      .expect(200);
    const internalCallId: string = dialRes.body.callId;
    const callRow = await getDb()
      .collection("calls")
      .findOne({ _id: internalCallId });
    const providerCallId: string = callRow!.providerCallId;

    const completed = callEventPayload(
      providerCallId,
      customerNumber,
      providerNumber,
      agentId,
      campaignId,
      internalCallId,
      { event_type: "completed", status: "answered", duration: 12, answer_duration: 10 },
    );
    await request(baseUrl).post("/webhooks/voicelink").send(completed).expect(200);
    // Voicelink retries — same payload, same providerCallId.
    await request(baseUrl).post("/webhooks/voicelink").send(completed).expect(200);
    await request(baseUrl).post("/webhooks/voicelink").send(completed).expect(200);

    const ledger = await getDb()
      .collection("credits_ledger")
      .find({ tenantId, type: "call" })
      .toArray();
    // Single debit despite 3 deliveries — partial-unique index in P2-G.
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.amount).toBe(-12);

    const credits = await getDb()
      .collection("credits")
      .findOne({ tenantId });
    expect(credits?.balance).toBe(200 - 12);

    // The audit trail still records every delivery.
    const eventRows = await getDb()
      .collection("call_events")
      .find({ providerCallId })
      .toArray();
    expect(eventRows).toHaveLength(3);
  });
});
