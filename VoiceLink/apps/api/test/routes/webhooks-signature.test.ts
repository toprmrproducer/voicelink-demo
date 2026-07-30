import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createHmac } from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";

import { createApp } from "../../src/server.js";
import { connectDb, closeDb, getDb } from "../../src/db/connection.js";

process.env.JWT_SECRET = "test-secret-must-be-at-least-16-chars-long";
process.env.BYOK_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let mongo: MongoMemoryServer;
let app: Express;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri(), "voiceplatform-webhook-sig-test");
  app = createApp();
});

afterAll(async () => {
  await closeDb();
  await mongo.stop();
});

beforeEach(async () => {
  for (const c of ["calls", "call_events"]) {
    await getDb().collection(c).deleteMany({});
  }
});

afterEach(() => {
  delete process.env.VOICELINK_WEBHOOK_SECRET;
  delete process.env.VOICELINK_WEBHOOK_HEADER;
});

const validBody = {
  event_type: "completed",
  unique_id: "vl-sig-1",
  call_id: "vl-sig-1",
  customer_number: "+919876543210",
  virtual_number: "+919999999999",
  call_type: "outbound",
  call_date: "2026-05-28T10:00:00+05:30",
  duration: 30,
  answer_duration: 25,
  status: "answered",
};

describe("POST /webhooks/voicelink — signature verification", () => {
  it("passthrough when VOICELINK_WEBHOOK_SECRET is unset (current prod stance)", async () => {
    const res = await request(app).post("/webhooks/voicelink").send(validBody);
    expect(res.status).toBe(200);
  });

  it("rejects with 401 when secret is set but no signature header", async () => {
    process.env.VOICELINK_WEBHOOK_SECRET = "shh";
    const res = await request(app).post("/webhooks/voicelink").send(validBody);
    expect(res.status).toBe(401);
  });

  it("accepts when signature matches the raw body", async () => {
    const secret = "shh";
    process.env.VOICELINK_WEBHOOK_SECRET = secret;
    // Compute signature on the same JSON serialization supertest will send.
    const raw = JSON.stringify(validBody);
    const sig = createHmac("sha256", secret).update(raw).digest("hex");

    const res = await request(app)
      .post("/webhooks/voicelink")
      .set("content-type", "application/json")
      .set("x-voicelink-signature", sig)
      .send(raw);
    expect(res.status).toBe(200);
  });

  it("rejects when signature is computed with the wrong secret", async () => {
    process.env.VOICELINK_WEBHOOK_SECRET = "right-secret";
    const raw = JSON.stringify(validBody);
    const sig = createHmac("sha256", "wrong-secret").update(raw).digest("hex");

    const res = await request(app)
      .post("/webhooks/voicelink")
      .set("content-type", "application/json")
      .set("x-voicelink-signature", sig)
      .send(raw);
    expect(res.status).toBe(401);
  });

  it("supports a custom header name via VOICELINK_WEBHOOK_HEADER", async () => {
    const secret = "shh";
    process.env.VOICELINK_WEBHOOK_SECRET = secret;
    process.env.VOICELINK_WEBHOOK_HEADER = "x-vlink-sig";
    const raw = JSON.stringify(validBody);
    const sig = createHmac("sha256", secret).update(raw).digest("hex");

    const res = await request(app)
      .post("/webhooks/voicelink")
      .set("content-type", "application/json")
      .set("x-vlink-sig", sig)
      .send(raw);
    expect(res.status).toBe(200);
  });
});
