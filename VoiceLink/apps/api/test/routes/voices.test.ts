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
  await connectDb(mongo.getUri(), "voiceplatform-test");
  app = createApp();
});

afterAll(async () => {
  await closeDb();
  await mongo.stop();
});

beforeEach(async () => {
  for (const c of ["users", "tenants"]) {
    await getDb().collection(c).deleteMany({});
  }
});

async function seedTenantOwnerToken(): Promise<string> {
  const db = getDb();
  const tenantId = new ObjectId().toString();
  await db.collection("tenants").insertOne({
    _id: tenantId,
    name: "Acme",
    plan: "starter",
    status: "active",
    telephony: {
      provider: "voicelink",
      providerClientId: 9001,
      walletThresholdNotify: 0,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const userId = new ObjectId().toString();
  await db.collection("users").insertOne({
    _id: userId,
    email: "u@example.com",
    passwordHash: "x",
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

describe("GET /voices", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).get("/voices");
    expect(res.status).toBe(401);
  });

  it("returns a non-empty catalog grouped under `voices`", async () => {
    const token = await seedTenantOwnerToken();
    const res = await request(app)
      .get("/voices")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.voices)).toBe(true);
    expect(res.body.voices.length).toBeGreaterThan(0);
  });

  it("each voice has provider + providerVoiceId + name and a known provider", async () => {
    const token = await seedTenantOwnerToken();
    const res = await request(app)
      .get("/voices")
      .set("Authorization", `Bearer ${token}`);
    const allowed = new Set([
      "openai-realtime",
      "gemini-live",
      "elevenlabs",
      "cartesia",
      "playht",
    ]);
    for (const v of res.body.voices) {
      expect(typeof v.provider).toBe("string");
      expect(allowed.has(v.provider)).toBe(true);
      expect(typeof v.providerVoiceId).toBe("string");
      expect(v.providerVoiceId.length).toBeGreaterThan(0);
      expect(typeof v.name).toBe("string");
      expect(v.name.length).toBeGreaterThan(0);
    }
  });

  it("includes at least one openai-realtime voice (the default realtime path)", async () => {
    const token = await seedTenantOwnerToken();
    const res = await request(app)
      .get("/voices")
      .set("Authorization", `Bearer ${token}`);
    const realtime = res.body.voices.filter(
      (v: { provider: string }) => v.provider === "openai-realtime",
    );
    expect(realtime.length).toBeGreaterThan(0);
  });

  it("includes TTS-provider library voices (elevenlabs and cartesia)", async () => {
    const token = await seedTenantOwnerToken();
    const res = await request(app)
      .get("/voices")
      .set("Authorization", `Bearer ${token}`);
    const providers = new Set(
      res.body.voices.map((v: { provider: string }) => v.provider),
    );
    expect(providers.has("elevenlabs")).toBe(true);
    expect(providers.has("cartesia")).toBe(true);
  });

  it("filters by provider when ?provider= is passed", async () => {
    const token = await seedTenantOwnerToken();
    const res = await request(app)
      .get("/voices?provider=openai-realtime")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    for (const v of res.body.voices) {
      expect(v.provider).toBe("openai-realtime");
    }
  });

  it("returns an empty list (not 400) for an unknown provider filter", async () => {
    const token = await seedTenantOwnerToken();
    const res = await request(app)
      .get("/voices?provider=not-a-thing")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.voices).toEqual([]);
  });

  it("voiceIds are unique within a provider", async () => {
    const token = await seedTenantOwnerToken();
    const res = await request(app)
      .get("/voices")
      .set("Authorization", `Bearer ${token}`);
    const byProvider = new Map<string, Set<string>>();
    for (const v of res.body.voices) {
      if (!byProvider.has(v.provider)) byProvider.set(v.provider, new Set());
      const set = byProvider.get(v.provider)!;
      expect(set.has(v.providerVoiceId)).toBe(false);
      set.add(v.providerVoiceId);
    }
  });
});
