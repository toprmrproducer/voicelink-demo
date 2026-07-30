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
import { signAuthToken } from "../../src/lib/jwt.js";

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
  for (const c of ["users", "tenants", "dids", "did_logs", "calls", "call_events"]) {
    await getDb().collection(c).deleteMany({});
  }
});

/** Seed a superadmin + a tenant, return Bearer token + tenantId. */
async function seedSuperadminAndTenant(
  voicelinkClientId = 4242,
): Promise<{ token: string; tenantId: string }> {
  const db = getDb();
  const userId = new ObjectId().toString();
  await db.collection("users").insertOne({
    _id: userId,
    email: "root@example.com",
    passwordHash: "irrelevant",
    role: "owner",
    isSuperadmin: true,
    tenantId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const tenantId = new ObjectId().toString();
  await db.collection("tenants").insertOne({
    _id: tenantId,
    name: "Acme",
    plan: "starter",
    status: "active",
    telephony: {
      provider: "voicelink",
      providerClientId: voicelinkClientId,
      walletThresholdNotify: 0,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const token = signAuthToken({
    sub: userId,
    tenantId: null,
    role: "owner",
    isSuperadmin: true,
  });
  return { token, tenantId };
}

/** Seed a non-superadmin user. */
async function seedRegularUser(tenantId: string): Promise<string> {
  const db = getDb();
  const userId = new ObjectId().toString();
  await db.collection("users").insertOne({
    _id: userId,
    email: "user@example.com",
    passwordHash: "irrelevant",
    role: "owner",
    isSuperadmin: false,
    tenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return signAuthToken({
    sub: userId,
    tenantId,
    role: "owner",
    isSuperadmin: false,
  });
}

describe("POST /admin/dids/assign — WS bot registration", () => {
  it("does NOT set providerBotId when WS_BASE_URL is unset (dev default)", async () => {
    delete process.env.WS_BASE_URL;
    const { token, tenantId } = await seedSuperadminAndTenant();
    await request(app)
      .post("/admin/dids/assign")
      .set("Authorization", `Bearer ${token}`)
      .send({ tenantId, providerNumber: "+919999999999" });
    const stored = await getDb()
      .collection("dids")
      .findOne({ providerNumber: "+919999999999" });
    expect(stored?.providerBotId).toBeUndefined();
  });

  it("sets providerBotId when WS_BASE_URL is set and provider returns one", async () => {
    process.env.WS_BASE_URL = "wss://api.example.com";
    process.env.VOICELINK_MODE = "mock";
    const { token, tenantId } = await seedSuperadminAndTenant();
    await request(app)
      .post("/admin/dids/assign")
      .set("Authorization", `Bearer ${token}`)
      .send({ tenantId, providerNumber: "+919999999998" });
    const stored = await getDb()
      .collection("dids")
      .findOne({ providerNumber: "+919999999998" });
    expect(typeof stored?.providerBotId).toBe("string");
    expect(stored?.providerBotId).toMatch(/.+/);
    delete process.env.WS_BASE_URL;
  });
});

describe("POST /admin/dids/assign", () => {
  it("creates a Did row when admin assigns a number to a tenant", async () => {
    const { token, tenantId } = await seedSuperadminAndTenant();
    const res = await request(app)
      .post("/admin/dids/assign")
      .set("Authorization", `Bearer ${token}`)
      .send({
        tenantId,
        provider: "voicelink",
        providerNumber: "+919999999999",
        didType: "mobile",
      });
    expect(res.status).toBe(201);
    expect(res.body.did).toMatchObject({
      tenantId,
      provider: "voicelink",
      providerNumber: "+919999999999",
      didType: "mobile",
      status: "active",
    });
    const stored = await getDb()
      .collection("dids")
      .findOne({ providerNumber: "+919999999999" });
    expect(stored).not.toBeNull();
    expect(stored?.tenantId).toBe(tenantId);
  });

  it("writes a did_logs entry on every assign", async () => {
    const { token, tenantId } = await seedSuperadminAndTenant();
    await request(app)
      .post("/admin/dids/assign")
      .set("Authorization", `Bearer ${token}`)
      .send({
        tenantId,
        providerNumber: "+919999999999",
      });
    const logs = await getDb().collection("did_logs").find({}).toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("assign");
    expect(logs[0].tenantId).toBe(tenantId);
  });

  it("is idempotent when re-assigning the same DID to the same tenant", async () => {
    const { token, tenantId } = await seedSuperadminAndTenant();
    const body = { tenantId, providerNumber: "+919999999999" };
    await request(app)
      .post("/admin/dids/assign")
      .set("Authorization", `Bearer ${token}`)
      .send(body);
    const res = await request(app)
      .post("/admin/dids/assign")
      .set("Authorization", `Bearer ${token}`)
      .send(body);
    // Idempotent: 200 + same Did doc (not duplicated)
    expect(res.status).toBe(200);
    const all = await getDb().collection("dids").find({}).toArray();
    expect(all).toHaveLength(1);
  });

  it("returns 409 when the DID is already linked to a DIFFERENT tenant", async () => {
    const { token, tenantId: t1 } = await seedSuperadminAndTenant(4242);
    await request(app)
      .post("/admin/dids/assign")
      .set("Authorization", `Bearer ${token}`)
      .send({ tenantId: t1, providerNumber: "+919999999999" });

    // Seed a second tenant
    const t2Id = new ObjectId().toString();
    await getDb().collection("tenants").insertOne({
      _id: t2Id,
      name: "BetaCorp",
      plan: "starter",
      status: "active",
      telephony: {
        provider: "voicelink",
        providerClientId: 5252,
        walletThresholdNotify: 0,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .post("/admin/dids/assign")
      .set("Authorization", `Bearer ${token}`)
      .send({ tenantId: t2Id, providerNumber: "+919999999999" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already linked/i);
    expect(res.body.tenantId).toBe(t1);
  });

  it("returns 404 to non-superadmin users (info-hiding pattern)", async () => {
    const { tenantId } = await seedSuperadminAndTenant();
    const regularToken = await seedRegularUser(tenantId);
    const res = await request(app)
      .post("/admin/dids/assign")
      .set("Authorization", `Bearer ${regularToken}`)
      .send({ tenantId, providerNumber: "+919999999999" });
    expect(res.status).toBe(404);
  });

  it("returns 400 on invalid input (missing providerNumber)", async () => {
    const { token, tenantId } = await seedSuperadminAndTenant();
    const res = await request(app)
      .post("/admin/dids/assign")
      .set("Authorization", `Bearer ${token}`)
      .send({ tenantId });
    expect(res.status).toBe(400);
  });

  it("returns 404 when assigning to a non-existent tenant", async () => {
    const { token } = await seedSuperadminAndTenant();
    const res = await request(app)
      .post("/admin/dids/assign")
      .set("Authorization", `Bearer ${token}`)
      .send({
        tenantId: new ObjectId().toString(),
        providerNumber: "+919999999999",
      });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/tenant/i);
  });

  it("backfills pending calls when DID is assigned after the fact", async () => {
    const { token, tenantId } = await seedSuperadminAndTenant();
    const db = getDb();

    // Simulate a call that landed before DID assignment
    await db.collection("calls").insertOne({
      _id: "pending-call-1",
      tenantId: "pending",
      agentId: "pending",
      direction: "out",
      providerCallId: "vl-pre-assign-1",
      fromNumber: "+919999999999",
      toNumber: "+919876543210",
      status: "completed",
      durationSec: 30,
      sentiment: "unknown",
      costCredits: 0,
      costCogs: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await request(app)
      .post("/admin/dids/assign")
      .set("Authorization", `Bearer ${token}`)
      .send({
        tenantId,
        providerNumber: "+919999999999",
        defaultAgentId: "agent-xyz",
      });

    const updated = await db.collection("calls").findOne({ _id: "pending-call-1" });
    expect(updated?.tenantId).toBe(tenantId);
    expect(updated?.agentId).toBe("agent-xyz");
  });

  it("backfill leaves agentId='pending' when no defaultAgentId is supplied", async () => {
    const { token, tenantId } = await seedSuperadminAndTenant();
    await getDb().collection("calls").insertOne({
      _id: "pending-call-2",
      tenantId: "pending",
      agentId: "pending",
      direction: "in",
      providerCallId: "vl-pre-assign-2",
      fromNumber: "+919876543210",
      toNumber: "+919999999999",
      status: "completed",
      durationSec: 30,
      sentiment: "unknown",
      costCredits: 0,
      costCogs: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await request(app)
      .post("/admin/dids/assign")
      .set("Authorization", `Bearer ${token}`)
      .send({ tenantId, providerNumber: "+919999999999" });
    const updated = await getDb()
      .collection("calls")
      .findOne({ _id: "pending-call-2" });
    expect(updated?.tenantId).toBe(tenantId);
    expect(updated?.agentId).toBe("pending");
  });
});

describe("GET /admin/dids", () => {
  it("returns all DIDs for superadmin", async () => {
    const { token, tenantId } = await seedSuperadminAndTenant();
    await request(app)
      .post("/admin/dids/assign")
      .set("Authorization", `Bearer ${token}`)
      .send({ tenantId, providerNumber: "+919999999991" });
    await request(app)
      .post("/admin/dids/assign")
      .set("Authorization", `Bearer ${token}`)
      .send({ tenantId, providerNumber: "+919999999992" });

    const res = await request(app)
      .get("/admin/dids")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.dids).toHaveLength(2);
    expect(res.body.dids.map((d: { providerNumber: string }) => d.providerNumber).sort()).toEqual([
      "+919999999991",
      "+919999999992",
    ]);
  });

  it("filters by tenantId when provided", async () => {
    const { token, tenantId: t1 } = await seedSuperadminAndTenant(4242);
    const t2Id = new ObjectId().toString();
    await getDb().collection("tenants").insertOne({
      _id: t2Id,
      name: "BetaCorp",
      plan: "starter",
      status: "active",
      telephony: {
        provider: "voicelink",
        providerClientId: 5252,
        walletThresholdNotify: 0,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await request(app)
      .post("/admin/dids/assign")
      .set("Authorization", `Bearer ${token}`)
      .send({ tenantId: t1, providerNumber: "+91111" });
    await request(app)
      .post("/admin/dids/assign")
      .set("Authorization", `Bearer ${token}`)
      .send({ tenantId: t2Id, providerNumber: "+91222" });

    const res = await request(app)
      .get(`/admin/dids?tenantId=${t1}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.dids).toHaveLength(1);
    expect(res.body.dids[0].providerNumber).toBe("+91111");
  });

  it("returns 404 to non-superadmin", async () => {
    const { tenantId } = await seedSuperadminAndTenant();
    const regularToken = await seedRegularUser(tenantId);
    const res = await request(app)
      .get("/admin/dids")
      .set("Authorization", `Bearer ${regularToken}`);
    expect(res.status).toBe(404);
  });
});
