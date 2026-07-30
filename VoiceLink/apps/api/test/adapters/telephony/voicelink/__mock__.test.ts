import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import request from "supertest";
import type { Express } from "express";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp } from "../../../../src/server.js";
import {
  connectDb,
  closeDb,
  getDb,
} from "../../../../src/db/connection.js";
import { VoicelinkMockProvider } from "../../../../src/adapters/telephony/voicelink/__mock__.js";

process.env.JWT_SECRET = "test-secret-must-be-at-least-16-chars-long";
process.env.BYOK_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let mongo: MongoMemoryServer;
let app: Express;
let httpServer: Server;
let webhookUrl: string;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri(), "voiceplatform-test");
  app = createApp();
  await new Promise<void>((resolve) => {
    httpServer = createServer(app).listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = httpServer.address() as AddressInfo;
  webhookUrl = `http://127.0.0.1:${port}/webhooks/voicelink`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await closeDb();
  await mongo.stop();
});

beforeEach(async () => {
  for (const c of ["calls", "call_events"]) {
    await getDb().collection(c).deleteMany({});
  }
});

describe("VoicelinkMockProvider — basic operations", () => {
  it("originateCall returns a unique providerCallId per request", async () => {
    const mock = new VoicelinkMockProvider();
    const a = await mock.originateCall({
      fromDid: "+919999999999",
      toNumber: "+919876543210",
    });
    const b = await mock.originateCall({
      fromDid: "+919999999999",
      toNumber: "+919876543211",
    });
    expect(a.providerCallId).not.toBe(b.providerCallId);
    expect(a.providerCallId).toMatch(/^vl-mock-call-/);
    expect(a.acceptedAt).toBeInstanceOf(Date);
  });

  it("listCalls reflects originateCall history", async () => {
    const mock = new VoicelinkMockProvider();
    await mock.originateCall({
      fromDid: "+919999999999",
      toNumber: "+919876543210",
    });
    await mock.originateCall({
      fromDid: "+919999999999",
      toNumber: "+919876543211",
    });
    expect(mock.listCalls()).toHaveLength(2);
  });

  it("registerWebSocketBot returns a unique providerBotId", async () => {
    const mock = new VoicelinkMockProvider();
    const bot = await mock.registerWebSocketBot({
      name: "agent-1",
      websocketUrl: "wss://ws.auto4you.in/call/tenant-1",
      providerClientId: "12345",
    });
    expect(bot.providerBotId).toMatch(/^vl-mock-bot-/);
    expect(bot.websocketUrl).toBe("wss://ws.auto4you.in/call/tenant-1");
    expect(bot.active).toBe(true);
  });

  it("getCallStatus returns null for unknown providerCallId", async () => {
    const mock = new VoicelinkMockProvider();
    expect(await mock.getCallStatus("nope")).toBeNull();
  });

  it("verifyWebhook returns true (mock — no signature scheme)", () => {
    const mock = new VoicelinkMockProvider();
    expect(mock.verifyWebhook({}, "{}")).toBe(true);
  });
});

describe("VoicelinkMockProvider — pacing", () => {
  it("bulkOriginate honors AbortSignal", async () => {
    const mock = new VoicelinkMockProvider();
    const controller = new AbortController();
    const inputs = Array.from({ length: 50 }, (_, i) => ({
      fromDid: "+919999999999",
      toNumber: `+9198765432${i.toString().padStart(2, "0")}`,
    }));
    setTimeout(() => controller.abort(), 30);
    const handles = await mock.bulkOriginate(inputs, {
      pacingCallsPerSecond: 100, // 10ms between calls
      signal: controller.signal,
    });
    // Should have dialed some but not all
    expect(handles.length).toBeGreaterThan(0);
    expect(handles.length).toBeLessThan(inputs.length);
  });

  it("bulkOriginate dispatches all when no signal/no abort", async () => {
    const mock = new VoicelinkMockProvider();
    const handles = await mock.bulkOriginate(
      [
        { fromDid: "+919999999999", toNumber: "+919876543210" },
        { fromDid: "+919999999999", toNumber: "+919876543211" },
      ],
      { pacingCallsPerSecond: 1000 },
    );
    expect(handles).toHaveLength(2);
  });
});

describe("VoicelinkMockProvider — webhook simulation (buffered)", () => {
  it("simulateCallEvent buffers events when no webhookSinkUrl is set", async () => {
    const mock = new VoicelinkMockProvider();
    const { providerCallId } = await mock.originateCall({
      fromDid: "+919999999999",
      toNumber: "+919876543210",
    });
    await mock.simulateCallEvent(providerCallId, {
      event_type: "ringing",
      status: "answered",
    });
    const events = mock.drainBufferedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe("ringing");
    expect(events[0]?.unique_id).toBe(providerCallId);
    expect(mock.drainBufferedEvents()).toHaveLength(0); // drained
  });

  it("simulateCallEvent throws for unknown providerCallId", async () => {
    const mock = new VoicelinkMockProvider();
    await expect(
      mock.simulateCallEvent("nope", {
        event_type: "ringing",
        status: "answered",
      }),
    ).rejects.toThrow(/unknown providerCallId/);
  });

  it("simulateFullCallLifecycle updates in-memory state across events", async () => {
    const mock = new VoicelinkMockProvider();
    const { providerCallId } = await mock.originateCall({
      fromDid: "+919999999999",
      toNumber: "+919876543210",
    });
    const events = await mock.simulateFullCallLifecycle(providerCallId, {
      answerDurationSec: 45,
    });
    expect(events.map((e) => e.event_type)).toEqual([
      "ringing",
      "answered",
      "completed",
    ]);
    const status = await mock.getCallStatus(providerCallId);
    expect(status?.status).toBe("completed");
    expect(status?.answerDurationSec).toBe(45);
  });

  it("simulateFailedCall fires ringing → completed/noanswer", async () => {
    const mock = new VoicelinkMockProvider();
    const { providerCallId } = await mock.originateCall({
      fromDid: "+919999999999",
      toNumber: "+919876543210",
    });
    const events = await mock.simulateFailedCall(providerCallId, "noanswer");
    expect(events).toHaveLength(2);
    expect(events[1]?.status).toBe("noanswer");
    const status = await mock.getCallStatus(providerCallId);
    expect(status?.status).toBe("failed");
  });
});

describe("VoicelinkMockProvider — end-to-end through the webhook receiver", () => {
  it("simulateFullCallLifecycle POSTs each event and the calls row reaches 'completed'", async () => {
    const mock = new VoicelinkMockProvider({ webhookSinkUrl: webhookUrl });
    const { providerCallId } = await mock.originateCall({
      fromDid: "+919999999999",
      toNumber: "+919876543210",
    });
    await mock.simulateFullCallLifecycle(providerCallId, {
      answerDurationSec: 30,
      recordingUrl: "https://recordings.example/abc.mp3",
    });

    const call = await getDb()
      .collection("calls")
      .findOne({ providerCallId });
    expect(call).not.toBeNull();
    expect(call?.status).toBe("completed");
    expect(call?.durationSec).toBe(35);
    expect(call?.recordingUrl).toBe("https://recordings.example/abc.mp3");

    const events = await getDb()
      .collection("call_events")
      .find({ providerCallId })
      .toArray();
    expect(events).toHaveLength(3);
  });

  it("dispatches an inbound call when call_type swapped", async () => {
    // For an inbound mock test we go around the originate path and just
    // request a webhook directly — the provider doesn't track inbound
    // calls itself (Voicelink dials our DID; the WS arrives without our
    // originateCall being called).
    await request(app)
      .post("/webhooks/voicelink")
      .send({
        event_type: "completed",
        unique_id: "vl-inbound-001",
        call_id: "vl-inbound-001",
        customer_number: "+919876543210",
        virtual_number: "+919999999999",
        agent_number: null,
        call_type: "inbound",
        call_date: new Date().toISOString(),
        duration: 22,
        answer_duration: 18,
        status: "answered",
        recording_path: "",
        hangup_cause: "normal_clearing",
      })
      .expect(200);
    const call = await getDb()
      .collection("calls")
      .findOne({ providerCallId: "vl-inbound-001" });
    expect(call?.direction).toBe("in");
  });
});
