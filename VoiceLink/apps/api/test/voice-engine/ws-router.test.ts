import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import http from "node:http";
import { AddressInfo } from "node:net";
import WebSocket from "ws";
import { MongoMemoryServer } from "mongodb-memory-server";

import { connectDb, closeDb, getDb } from "../../src/db/connection.js";
import { mountCallWsRouter } from "../../src/voice-engine/ws-router.js";
import { FakeRealtimeProvider } from "../../src/adapters/llm/fake.js";

let mongo: MongoMemoryServer;
let server: http.Server;
let baseUrl: string;
let fakeProvider: FakeRealtimeProvider;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri(), "voiceplatform-ws-test");
  server = http.createServer();
  // Always hand out the same fake so tests can assert against its
  // accumulated state. realtimeForAgent normally constructs fresh ones,
  // but for this dataplane test the identity of the provider matters.
  fakeProvider = new FakeRealtimeProvider();
  mountCallWsRouter(server, {
    realtimeFactory: () => {
      fakeProvider = new FakeRealtimeProvider();
      return fakeProvider;
    },
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `ws://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDb();
  await mongo.stop();
});

beforeEach(async () => {
  for (const c of ["dids", "agents", "calls"]) {
    await getDb().collection(c).deleteMany({});
  }
});

async function seedDidAndAgent(
  opts: { defaultAgentId?: string; agentId?: string; tenantId?: string } = {},
): Promise<{ didId: string; agentId: string; tenantId: string }> {
  const tenantId = opts.tenantId ?? "tenant-x";
  const agentId = opts.agentId ?? "agent-x";
  const didId = "did-x";
  await getDb().collection("dids").insertOne({
    _id: didId,
    tenantId,
    provider: "voicelink",
    providerNumber: "+919999999999",
    didType: "mobile",
    defaultAgentId: opts.defaultAgentId,
    status: "active",
    assignedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await getDb().collection("agents").insertOne({
    _id: agentId,
    tenantId,
    name: "Pickup Bot",
    prompt: "",
    voice: { provider: "openai-realtime", providerVoiceId: "alloy" },
    llm: { realtimeModel: "gpt-4o-mini-realtime", temperature: 0.7 },
    tools: [],
    greeting: "Hello",
    endCallTriggers: [],
    status: "draft",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { didId, agentId, tenantId };
}

function openSocket(path: string): Promise<{
  ws: WebSocket;
  opened: boolean;
  closeCode?: number;
}> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${baseUrl}${path}`);
    let opened = false;
    ws.once("open", () => {
      opened = true;
      resolve({ ws, opened });
    });
    ws.once("error", () => {
      if (!opened) resolve({ ws, opened: false });
    });
    ws.once("close", (code) => {
      if (!opened) resolve({ ws, opened: false, closeCode: code });
    });
  });
}

describe("WS upgrade routing", () => {
  it("rejects upgrade on a path that isn't /ws/voicelink/:didId", async () => {
    const res = await openSocket("/ws/garbage/123");
    expect(res.opened).toBe(false);
  });

  it("rejects upgrade for an unknown DID", async () => {
    const res = await openSocket("/ws/voicelink/no-such-did");
    expect(res.opened).toBe(false);
  });

  it("rejects inbound upgrade when the DID has no defaultAgentId", async () => {
    const { didId } = await seedDidAndAgent({ defaultAgentId: undefined });
    const res = await openSocket(`/ws/voicelink/${didId}`);
    expect(res.opened).toBe(false);
  });

  it("accepts inbound upgrade when the DID has a defaultAgentId", async () => {
    const { didId, agentId } = await seedDidAndAgent({ defaultAgentId: "agent-x" });
    expect(agentId).toBe("agent-x");
    const res = await openSocket(`/ws/voicelink/${didId}`);
    expect(res.opened).toBe(true);
    res.ws.close();
  });
});

describe("WS outbound (callId in query)", () => {
  it("accepts upgrade when the callId points at a same-tenant call", async () => {
    const { didId, tenantId, agentId } = await seedDidAndAgent({
      defaultAgentId: "agent-x",
    });
    await getDb().collection("calls").insertOne({
      _id: "call-out-1",
      tenantId,
      agentId,
      direction: "out",
      providerCallId: "vl-1",
      fromNumber: "+919999999999",
      toNumber: "+919811111111",
      status: "ringing",
      durationSec: 0,
      sentiment: "unknown",
      costCredits: 0,
      costCogs: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await openSocket(`/ws/voicelink/${didId}?callId=call-out-1`);
    expect(res.opened).toBe(true);
    res.ws.close();
  });

  it("falls back to defaultAgentId when callId references a cross-tenant call", async () => {
    const { didId, tenantId } = await seedDidAndAgent({
      defaultAgentId: "agent-x",
      tenantId: "tenant-a",
    });
    expect(tenantId).toBe("tenant-a");
    // Same-tenant agent must exist for fallback to succeed
    await getDb().collection("calls").insertOne({
      _id: "call-cross",
      tenantId: "OTHER-TENANT",
      agentId: "evil-agent",
      direction: "out",
      providerCallId: "vl-x",
      fromNumber: "+919999999999",
      toNumber: "+919811111111",
      status: "ringing",
      durationSec: 0,
      sentiment: "unknown",
      costCredits: 0,
      costCogs: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await openSocket(`/ws/voicelink/${didId}?callId=call-cross`);
    // Still opens because defaultAgentId is set on the DID.
    expect(res.opened).toBe(true);
    res.ws.close();
  });
});

describe("Start-frame backfill", () => {
  it("upserts the calls row with providerCallId after an inbound start frame", async () => {
    const { didId } = await seedDidAndAgent({ defaultAgentId: "agent-x" });
    const res = await openSocket(`/ws/voicelink/${didId}`);
    expect(res.opened).toBe(true);

    // Mirror Voicelink's first frame (Twilio-style envelope).
    res.ws.send(
      JSON.stringify({
        event: "start",
        start: {
          callSid: "vl-incoming-42",
          customParameters: { from: "+919811111111" },
        },
      }),
    );

    // Wait for the upsert to land. Poll for up to 1s.
    let row: { providerCallId?: string } | null = null;
    for (let i = 0; i < 20 && !row?.providerCallId; i++) {
      await new Promise((r) => setTimeout(r, 50));
      row = await getDb()
        .collection<{ providerCallId?: string }>("calls")
        .findOne({ providerCallId: "vl-incoming-42" });
    }
    expect(row).not.toBeNull();
    expect(row?.providerCallId).toBe("vl-incoming-42");
    res.ws.close();
  });
});
