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

import { createApp } from "../../src/server.js";
import { connectDb, closeDb, getDb } from "../../src/db/connection.js";

// Required for createApp() — see auth-and-tenancy.test.ts for the pattern.
process.env.JWT_SECRET = "test-secret-must-be-at-least-16-chars-long";
process.env.BYOK_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let mongo: MongoMemoryServer;
let app: Express;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri(), "voiceplatform-test");
  app = createApp();
});

afterAll(async () => {
  await closeDb();
  await mongo.stop();
});

beforeEach(async () => {
  const db = getDb();
  for (const c of ["calls", "call_events"]) {
    await db.collection(c).deleteMany({});
  }
});

/** Sample payload that mirrors what Voicelink's "Add Call Event API" UI sends */
function samplePayload(overrides: Record<string, unknown> = {}) {
  return {
    event_type: "completed",
    unique_id: "vl-call-12345",
    call_id: "vl-call-12345",
    customer_number: "+919876543210",
    virtual_number: "+919999999999",
    agent_number: null,
    call_type: "outbound",
    call_date: "2026-05-26T10:23:45+05:30",
    duration: 65,
    answer_duration: 50,
    status: "answered",
    recording_path: "https://recordings.voicelink.co.in/vl-call-12345.mp3",
    hangup_cause: "normal_clearing",
    ...overrides,
  };
}

describe("POST /webhooks/voicelink", () => {
  it("accepts a well-formed call event and returns 200", async () => {
    const res = await request(app)
      .post("/webhooks/voicelink")
      .send(samplePayload());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it("persists the event to call_events (audit trail)", async () => {
    await request(app).post("/webhooks/voicelink").send(samplePayload());
    const events = await getDb().collection("call_events").find({}).toArray();
    expect(events).toHaveLength(1);
    expect(events[0].providerCallId).toBe("vl-call-12345");
    expect(events[0].eventType).toBe("completed");
    expect(events[0].rawPayload.recording_path).toContain("voicelink.co.in");
  });

  it("upserts a calls document (one row per providerCallId)", async () => {
    await request(app).post("/webhooks/voicelink").send(samplePayload());
    const calls = await getDb().collection("calls").find({}).toArray();
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.providerCallId).toBe("vl-call-12345");
    expect(call.direction).toBe("out");
    expect(call.status).toBe("completed");
    expect(call.fromNumber).toBe("+919999999999"); // virtual_number (the DID)
    expect(call.toNumber).toBe("+919876543210"); // customer_number
    expect(call.durationSec).toBe(65);
    expect(call.recordingUrl).toContain("voicelink.co.in");
  });

  it("updates the same call row when multiple events arrive (ringing → answered → completed)", async () => {
    await request(app)
      .post("/webhooks/voicelink")
      .send(samplePayload({ event_type: "ringing", status: "answered" }));
    await request(app)
      .post("/webhooks/voicelink")
      .send(samplePayload({ event_type: "answered", status: "answered" }));
    await request(app)
      .post("/webhooks/voicelink")
      .send(samplePayload({ event_type: "completed", status: "answered" }));

    const calls = await getDb().collection("calls").find({}).toArray();
    expect(calls).toHaveLength(1);
    expect(calls[0].status).toBe("completed");

    const events = await getDb().collection("call_events").find({}).toArray();
    expect(events).toHaveLength(3);
  });

  it("maps event_type=completed + status=failed to CallStatus=failed", async () => {
    await request(app)
      .post("/webhooks/voicelink")
      .send(samplePayload({ event_type: "completed", status: "failed" }));
    const call = await getDb().collection("calls").findOne({});
    expect(call?.status).toBe("failed");
  });

  it("maps event_type=ringing to CallStatus=ringing", async () => {
    await request(app)
      .post("/webhooks/voicelink")
      .send(samplePayload({ event_type: "ringing" }));
    const call = await getDb().collection("calls").findOne({});
    expect(call?.status).toBe("ringing");
  });

  it("maps call_type=inbound to direction=in (and swaps from/to)", async () => {
    await request(app)
      .post("/webhooks/voicelink")
      .send(samplePayload({ call_type: "inbound" }));
    const call = await getDb().collection("calls").findOne({});
    expect(call?.direction).toBe("in");
    // For inbound: the customer dials our DID, so fromNumber=customer, toNumber=DID
    expect(call?.fromNumber).toBe("+919876543210");
    expect(call?.toNumber).toBe("+919999999999");
  });

  it("rejects an empty body with 400", async () => {
    const res = await request(app).post("/webhooks/voicelink").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("rejects a payload with a missing required field with 400", async () => {
    const payload = samplePayload();
    delete (payload as Record<string, unknown>).unique_id;
    const res = await request(app).post("/webhooks/voicelink").send(payload);
    expect(res.status).toBe(400);
  });

  it("rejects an unknown event_type with 400", async () => {
    const res = await request(app)
      .post("/webhooks/voicelink")
      .send(samplePayload({ event_type: "ufo" }));
    expect(res.status).toBe(400);
  });

  it("accepts a payload with extra custom headers (passthrough)", async () => {
    const res = await request(app)
      .post("/webhooks/voicelink")
      .send(
        samplePayload({
          header_1: "campaign-7",
          header_2: "lead-source-google",
        }),
      );
    expect(res.status).toBe(200);
    const event = await getDb().collection("call_events").findOne({});
    expect(event?.rawPayload.header_1).toBe("campaign-7");
  });

  it("tolerates empty string for optional fields (recording_path)", async () => {
    const res = await request(app)
      .post("/webhooks/voicelink")
      .send(samplePayload({ recording_path: "" }));
    expect(res.status).toBe(200);
    const call = await getDb().collection("calls").findOne({});
    expect(call?.recordingUrl).toBeUndefined();
  });
});
