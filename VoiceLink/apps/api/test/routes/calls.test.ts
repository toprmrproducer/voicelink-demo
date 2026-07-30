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
import { connectDb, closeDb, getDb } from "../../src/db/connection.js";
import { signAuthToken } from "../../src/lib/jwt.js";

process.env.JWT_SECRET = "test-secret-must-be-at-least-16-chars-long";
process.env.BYOK_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let mongo: MongoMemoryServer;
let app: Express;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri(), "voiceplatform-calls-test");
  app = createApp();
});

afterAll(async () => {
  await closeDb();
  await mongo.stop();
});

beforeEach(async () => {
  for (const c of ["users", "tenants", "calls"]) {
    await getDb().collection(c).deleteMany({});
  }
});

let providerClientIdSeq = 70_000;

async function seedTenantAndOwner(
  email = "owner@example.com",
): Promise<{ token: string; tenantId: string }> {
  const db = getDb();
  const tenantId = new ObjectId().toString();
  await db.collection("tenants").insertOne({
    _id: tenantId,
    name: "Acme",
    plan: "starter",
    status: "active",
    telephony: {
      provider: "voicelink",
      providerClientId: providerClientIdSeq++,
      walletThresholdNotify: 0,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const userId = new ObjectId().toString();
  await db.collection("users").insertOne({
    _id: userId,
    email,
    passwordHash: "x",
    role: "owner",
    isSuperadmin: false,
    tenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const token = signAuthToken({
    sub: userId,
    tenantId,
    role: "owner",
    isSuperadmin: false,
  });
  return { token, tenantId };
}

interface SeedCallOpts {
  tenantId: string;
  agentId?: string;
  campaignId?: string;
  status?: "queued" | "ringing" | "inprogress" | "completed" | "failed";
  direction?: "in" | "out";
  createdAt?: Date;
}

async function seedCall(opts: SeedCallOpts): Promise<string> {
  const id = new ObjectId().toString();
  const now = opts.createdAt ?? new Date();
  await getDb().collection("calls").insertOne({
    _id: id,
    tenantId: opts.tenantId,
    agentId: opts.agentId ?? "agent-x",
    campaignId: opts.campaignId,
    direction: opts.direction ?? "out",
    providerCallId: `vl-${id}`,
    fromNumber: "+919999999999",
    toNumber: "+918888888888",
    status: opts.status ?? "completed",
    durationSec: 42,
    sentiment: "unknown",
    costCredits: 42,
    costCogs: 0,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe("GET /calls", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).get("/calls");
    expect(res.status).toBe(401);
  });

  it("returns the caller's tenant calls only", async () => {
    const { token, tenantId } = await seedTenantAndOwner("a@example.com");
    const { tenantId: otherTenantId } = await seedTenantAndOwner("b@example.com");
    await seedCall({ tenantId });
    await seedCall({ tenantId });
    await seedCall({ tenantId: otherTenantId });

    const res = await request(app)
      .get("/calls")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.calls).toHaveLength(2);
    expect(res.body.calls.every((c: { tenantId: string }) => c.tenantId === tenantId)).toBe(true);
  });

  it("filters by status / direction", async () => {
    const { token, tenantId } = await seedTenantAndOwner();
    await seedCall({ tenantId, status: "completed", direction: "out" });
    await seedCall({ tenantId, status: "failed", direction: "in" });

    const res = await request(app)
      .get("/calls?status=failed")
      .set("Authorization", `Bearer ${token}`);
    expect(res.body.calls).toHaveLength(1);
    expect(res.body.calls[0].status).toBe("failed");
  });

  it("honors limit (cap 200)", async () => {
    const { token, tenantId } = await seedTenantAndOwner();
    for (let i = 0; i < 5; i++) await seedCall({ tenantId });
    const res = await request(app)
      .get("/calls?limit=2")
      .set("Authorization", `Bearer ${token}`);
    expect(res.body.calls).toHaveLength(2);
  });
});

describe("GET /calls/:id", () => {
  it("returns 404 for cross-tenant calls (info-hiding)", async () => {
    const { token } = await seedTenantAndOwner("a@example.com");
    const { tenantId: other } = await seedTenantAndOwner("b@example.com");
    const callId = await seedCall({ tenantId: other });

    const res = await request(app)
      .get(`/calls/${callId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("returns the call when owned by the tenant", async () => {
    const { token, tenantId } = await seedTenantAndOwner();
    const callId = await seedCall({ tenantId });
    const res = await request(app)
      .get(`/calls/${callId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body._id).toBe(callId);
  });
});
