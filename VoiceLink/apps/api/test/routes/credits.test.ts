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
  await connectDb(mongo.getUri(), "voiceplatform-credits-test");
  app = createApp();
});

afterAll(async () => {
  await closeDb();
  await mongo.stop();
});

beforeEach(async () => {
  for (const c of ["users", "tenants", "credits", "credits_ledger"]) {
    await getDb().collection(c).deleteMany({});
  }
});

let providerClientIdSeq = 10_000;

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

async function seedSuperadmin(): Promise<string> {
  const db = getDb();
  const userId = new ObjectId().toString();
  await db.collection("users").insertOne({
    _id: userId,
    email: "root@example.com",
    passwordHash: "x",
    role: "owner",
    isSuperadmin: true,
    tenantId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return signAuthToken({
    sub: userId,
    tenantId: null,
    role: "owner",
    isSuperadmin: true,
  });
}

describe("GET /credits", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).get("/credits");
    expect(res.status).toBe(401);
  });

  it("returns 0 balance + [] for a fresh tenant", async () => {
    const { token } = await seedTenantAndOwner();
    const res = await request(app)
      .get("/credits")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(0);
    expect(res.body.entries).toEqual([]);
  });

  it("returns only the caller's tenant ledger (cross-tenant isolation)", async () => {
    const { token, tenantId } = await seedTenantAndOwner("a@example.com");
    const { token: otherToken } = await seedTenantAndOwner("b@example.com");

    // Top up tenant A via the admin route as superadmin.
    const adminToken = await seedSuperadmin();
    await request(app)
      .post("/admin/credits/topup")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ tenantId, amount: 500, note: "seed A" });

    const a = await request(app)
      .get("/credits")
      .set("Authorization", `Bearer ${token}`);
    expect(a.body.balance).toBe(500);
    expect(a.body.entries.length).toBe(1);

    const b = await request(app)
      .get("/credits")
      .set("Authorization", `Bearer ${otherToken}`);
    expect(b.body.balance).toBe(0);
    expect(b.body.entries).toEqual([]);
  });

  it("honors the limit query param (capped at 200)", async () => {
    const { token, tenantId } = await seedTenantAndOwner();
    const adminToken = await seedSuperadmin();
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/admin/credits/topup")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ tenantId, amount: 10, note: `seed ${i}` });
    }
    const res = await request(app)
      .get("/credits?limit=3")
      .set("Authorization", `Bearer ${token}`);
    expect(res.body.balance).toBe(50);
    expect(res.body.entries).toHaveLength(3);
  });
});

describe("POST /admin/credits/topup", () => {
  it("returns 401 without a token", async () => {
    const { tenantId } = await seedTenantAndOwner();
    const res = await request(app)
      .post("/admin/credits/topup")
      .send({ tenantId, amount: 100 });
    expect(res.status).toBe(401);
  });

  it("returns 404 to non-superadmin (info-hiding pattern)", async () => {
    const { token, tenantId } = await seedTenantAndOwner();
    const res = await request(app)
      .post("/admin/credits/topup")
      .set("Authorization", `Bearer ${token}`)
      .send({ tenantId, amount: 100 });
    expect(res.status).toBe(404);
  });

  it("credits the tenant and returns the new balance", async () => {
    const { tenantId } = await seedTenantAndOwner();
    const adminToken = await seedSuperadmin();
    const res = await request(app)
      .post("/admin/credits/topup")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ tenantId, amount: 250, note: "welcome bonus" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tenantId, balance: 250 });
    expect(typeof res.body.ledgerId).toBe("string");
  });

  it("returns 400 on invalid input (amount <= 0)", async () => {
    const { tenantId } = await seedTenantAndOwner();
    const adminToken = await seedSuperadmin();
    const res = await request(app)
      .post("/admin/credits/topup")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ tenantId, amount: -5 });
    expect(res.status).toBe(400);
  });

  it("returns 404 for a non-existent tenant", async () => {
    const adminToken = await seedSuperadmin();
    const res = await request(app)
      .post("/admin/credits/topup")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ tenantId: new ObjectId().toString(), amount: 100 });
    expect(res.status).toBe(404);
  });
});

describe("GET /admin/credits/:tenantId", () => {
  it("returns balance + ledger for a tenant (superadmin only)", async () => {
    const { tenantId } = await seedTenantAndOwner();
    const adminToken = await seedSuperadmin();
    await request(app)
      .post("/admin/credits/topup")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ tenantId, amount: 100 });
    const res = await request(app)
      .get(`/admin/credits/${tenantId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(100);
    expect(res.body.entries).toHaveLength(1);
  });

  it("returns 404 to non-superadmin", async () => {
    const { token, tenantId } = await seedTenantAndOwner();
    const res = await request(app)
      .get(`/admin/credits/${tenantId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
