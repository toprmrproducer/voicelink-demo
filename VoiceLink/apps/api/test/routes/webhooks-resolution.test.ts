/**
 * Webhook receiver — DID resolution (tenantId + agentId).
 * Complements the original webhooks.test.ts which covers payload shape.
 */

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
import { ObjectId } from "mongodb";

import { createApp } from "../../src/server.js";
import {
  connectDb,
  closeDb,
  getDb,
} from "../../src/db/connection.js";

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
  for (const c of ["calls", "call_events", "dids", "credits", "credits_ledger"]) {
    await getDb().collection(c).deleteMany({});
  }
});

/** Helper — seed a DID assignment directly to skip the admin route. */
async function seedDid(opts: {
  tenantId: string;
  providerNumber: string;
  defaultAgentId?: string;
}): Promise<void> {
  const now = new Date();
  const doc: Record<string, unknown> = {
    _id: new ObjectId().toString(),
    tenantId: opts.tenantId,
    provider: "voicelink",
    providerNumber: opts.providerNumber,
    didType: "mobile",
    status: "active",
    assignedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  if (opts.defaultAgentId !== undefined) {
    doc.defaultAgentId = opts.defaultAgentId;
  }
  await getDb().collection("dids").insertOne(doc);
}

function samplePayload(overrides: Record<string, unknown> = {}) {
  return {
    event_type: "completed",
    unique_id: "vl-call-resolve-1",
    call_id: "vl-call-resolve-1",
    customer_number: "+919876543210",
    virtual_number: "+919999999999",
    agent_number: null,
    call_type: "outbound",
    call_date: "2026-05-26T10:23:45+05:30",
    duration: 65,
    answer_duration: 50,
    status: "answered",
    recording_path: "",
    hangup_cause: "normal_clearing",
    ...overrides,
  };
}

describe("webhook receiver — DID resolution", () => {
  it("resolves tenantId from the DID assignment (outbound)", async () => {
    const tenantId = new ObjectId().toString();
    await seedDid({
      tenantId,
      providerNumber: "+919999999999",
      defaultAgentId: "agent-default",
    });
    await request(app)
      .post("/webhooks/voicelink")
      .send(samplePayload())
      .expect(200);
    const call = await getDb()
      .collection("calls")
      .findOne({ providerCallId: "vl-call-resolve-1" });
    expect(call?.tenantId).toBe(tenantId);
    // No custom_parameters → falls back to DID's defaultAgentId.
    expect(call?.agentId).toBe("agent-default");
  });

  it("inbound call (customer dials our DID) also resolves via virtual_number", async () => {
    const tenantId = new ObjectId().toString();
    await seedDid({
      tenantId,
      providerNumber: "+919999999999",
      defaultAgentId: "agent-inbound",
    });
    await request(app)
      .post("/webhooks/voicelink")
      .send(samplePayload({ call_type: "inbound" }))
      .expect(200);
    const call = await getDb()
      .collection("calls")
      .findOne({ providerCallId: "vl-call-resolve-1" });
    expect(call?.direction).toBe("in");
    expect(call?.tenantId).toBe(tenantId);
    expect(call?.agentId).toBe("agent-inbound");
  });

  it("custom_parameters.agentId beats DID default (outbound campaign assignment)", async () => {
    const tenantId = new ObjectId().toString();
    await seedDid({
      tenantId,
      providerNumber: "+919999999999",
      defaultAgentId: "agent-default",
    });
    const customParams = JSON.stringify({
      agentId: "agent-campaign-7",
      campaignId: "camp-7",
    });
    await request(app)
      .post("/webhooks/voicelink")
      .send(samplePayload({ custom_parameters: customParams }))
      .expect(200);
    const call = await getDb()
      .collection("calls")
      .findOne({ providerCallId: "vl-call-resolve-1" });
    expect(call?.agentId).toBe("agent-campaign-7");
    expect(call?.campaignId).toBe("camp-7");
  });

  it("malformed custom_parameters falls back to DID default", async () => {
    const tenantId = new ObjectId().toString();
    await seedDid({
      tenantId,
      providerNumber: "+919999999999",
      defaultAgentId: "agent-default",
    });
    await request(app)
      .post("/webhooks/voicelink")
      .send(samplePayload({ custom_parameters: "not-json{{}" }))
      .expect(200);
    const call = await getDb()
      .collection("calls")
      .findOne({ providerCallId: "vl-call-resolve-1" });
    expect(call?.agentId).toBe("agent-default");
  });

  it("agentId stays 'pending' when no DID default and no custom_parameters", async () => {
    const tenantId = new ObjectId().toString();
    await seedDid({ tenantId, providerNumber: "+919999999999" });
    await request(app)
      .post("/webhooks/voicelink")
      .send(samplePayload())
      .expect(200);
    const call = await getDb()
      .collection("calls")
      .findOne({ providerCallId: "vl-call-resolve-1" });
    expect(call?.tenantId).toBe(tenantId);
    expect(call?.agentId).toBe("pending");
  });

  it("falls back to tenantId='pending' when DID isn't assigned", async () => {
    // No seedDid call — virtual_number is unknown.
    await request(app)
      .post("/webhooks/voicelink")
      .send(samplePayload())
      .expect(200);
    const call = await getDb()
      .collection("calls")
      .findOne({ providerCallId: "vl-call-resolve-1" });
    expect(call?.tenantId).toBe("pending");
    expect(call?.agentId).toBe("pending");
  });

  it("multi-event lifecycle keeps the resolved tenantId/agentId stable", async () => {
    const tenantId = new ObjectId().toString();
    await seedDid({
      tenantId,
      providerNumber: "+919999999999",
      defaultAgentId: "agent-default",
    });
    for (const event_type of ["ringing", "answered", "completed"]) {
      await request(app)
        .post("/webhooks/voicelink")
        .send(samplePayload({ event_type }))
        .expect(200);
    }
    const call = await getDb()
      .collection("calls")
      .findOne({ providerCallId: "vl-call-resolve-1" });
    expect(call?.tenantId).toBe(tenantId);
    expect(call?.agentId).toBe("agent-default");
    expect(call?.status).toBe("completed");
  });

  it("custom_parameters with only campaignId (no agentId) keeps DID default for agent", async () => {
    const tenantId = new ObjectId().toString();
    await seedDid({
      tenantId,
      providerNumber: "+919999999999",
      defaultAgentId: "agent-default",
    });
    await request(app)
      .post("/webhooks/voicelink")
      .send(
        samplePayload({
          custom_parameters: JSON.stringify({ campaignId: "camp-99" }),
        }),
      )
      .expect(200);
    const call = await getDb()
      .collection("calls")
      .findOne({ providerCallId: "vl-call-resolve-1" });
    expect(call?.agentId).toBe("agent-default");
    expect(call?.campaignId).toBe("camp-99");
  });
});

describe("webhook receiver — credits debit", () => {
  it("debits the tenant + backfills costCredits on a completed event", async () => {
    const tenantId = new ObjectId().toString();
    await seedDid({
      tenantId,
      providerNumber: "+919999999999",
      defaultAgentId: "agent-default",
    });
    await getDb().collection("credits").insertOne({
      _id: tenantId,
      tenantId,
      balance: 1000,
      unit: "minutes",
      updatedAt: new Date(),
    });
    await request(app)
      .post("/webhooks/voicelink")
      .send(samplePayload({ duration: 30 }))
      .expect(200);

    const credits = await getDb()
      .collection("credits")
      .findOne({ tenantId });
    expect(credits?.balance).toBe(970);

    const call = await getDb()
      .collection("calls")
      .findOne({ providerCallId: "vl-call-resolve-1" });
    expect(call?.costCredits).toBe(30);

    const ledger = await getDb()
      .collection("credits_ledger")
      .find({ tenantId, type: "call" })
      .toArray();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].amount).toBe(-30);
  });

  it("is idempotent on webhook redelivery (same providerCallId)", async () => {
    const tenantId = new ObjectId().toString();
    await seedDid({
      tenantId,
      providerNumber: "+919999999999",
      defaultAgentId: "agent-default",
    });
    await getDb().collection("credits").insertOne({
      _id: tenantId,
      tenantId,
      balance: 1000,
      unit: "minutes",
      updatedAt: new Date(),
    });
    // Voicelink redelivers the completed event 3 times.
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/webhooks/voicelink")
        .send(samplePayload({ duration: 30 }))
        .expect(200);
    }
    const credits = await getDb().collection("credits").findOne({ tenantId });
    expect(credits?.balance).toBe(970); // debited once, not three times
    const ledger = await getDb()
      .collection("credits_ledger")
      .find({ tenantId, type: "call" })
      .toArray();
    expect(ledger).toHaveLength(1);
  });

  it("skips debit when tenant is unresolved (DID not assigned yet)", async () => {
    // No DID seeded → resolver leaves tenantId as "pending"
    await request(app)
      .post("/webhooks/voicelink")
      .send(samplePayload({ duration: 30 }))
      .expect(200);
    // No credits or ledger rows touched
    const credits = await getDb().collection("credits").find({}).toArray();
    expect(credits).toHaveLength(0);
    const ledger = await getDb().collection("credits_ledger").find({}).toArray();
    expect(ledger).toHaveLength(0);
  });
});
