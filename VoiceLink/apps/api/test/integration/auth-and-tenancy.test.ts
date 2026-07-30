import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { MongoMemoryServer } from "mongodb-memory-server";

import { createApp } from "../../src/server.js";
import { connectDb, closeDb, getDb } from "../../src/db/connection.js";
import { _testHelpers } from "../../src/routes/auth.routes.js";
import { tenantScope } from "../../src/middleware/tenant.js";

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
  // Wipe data between tests so they're independent. Indexes survive deleteMany.
  const db = getDb();
  for (const c of ["users", "tenants"]) {
    await db.collection(c).deleteMany({});
  }
});

describe("POST /auth/signup", () => {
  it("creates a user and returns a JWT", async () => {
    const res = await request(app)
      .post("/auth/signup")
      .send({ email: "alice@example.com", password: "hunter2hunter2" });
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^eyJ/);
    expect(res.body.user.email).toBe("alice@example.com");
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.user.tenantId).toBeNull();
  });

  it("rejects duplicate email with 409", async () => {
    await request(app)
      .post("/auth/signup")
      .send({ email: "dup@example.com", password: "hunter2hunter2" });
    const res = await request(app)
      .post("/auth/signup")
      .send({ email: "dup@example.com", password: "hunter2hunter2" });
    expect(res.status).toBe(409);
  });

  it("rejects short passwords with 400", async () => {
    const res = await request(app)
      .post("/auth/signup")
      .send({ email: "short@example.com", password: "abc" });
    expect(res.status).toBe(400);
  });
});

describe("POST /auth/login", () => {
  it("returns a JWT for valid credentials", async () => {
    await request(app)
      .post("/auth/signup")
      .send({ email: "bob@example.com", password: "hunter2hunter2" });
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "bob@example.com", password: "hunter2hunter2" });
    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^eyJ/);
  });

  it("returns 401 for wrong password", async () => {
    await request(app)
      .post("/auth/signup")
      .send({ email: "c@example.com", password: "hunter2hunter2" });
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "c@example.com", password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("returns 401 for unknown user", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "ghost@example.com", password: "hunter2hunter2" });
    expect(res.status).toBe(401);
  });
});

describe("POST /admin/tenants/link", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app)
      .post("/admin/tenants/link")
      .send({ name: "Acme", voicelinkClientId: 42 });
    expect(res.status).toBe(401);
  });

  it("returns 404 for non-superadmin (info-hiding, not 403)", async () => {
    const signup = await request(app)
      .post("/auth/signup")
      .send({ email: "regular@example.com", password: "hunter2hunter2" });
    const token = signup.body.token;
    const res = await request(app)
      .post("/admin/tenants/link")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Acme", voicelinkClientId: 42 });
    expect(res.status).toBe(404);
  });

  it("creates a tenant for a superadmin", async () => {
    const { token } = await _testHelpers.createSuperadmin(
      "root@platform",
      "rootpassword",
    );
    const res = await request(app)
      .post("/admin/tenants/link")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Acme Telesales", voicelinkClientId: 1001 });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Acme Telesales");
    expect(res.body.telephony.providerClientId).toBe(1001);
  });

  it("rejects duplicate voicelinkClientId with 409", async () => {
    const { token } = await _testHelpers.createSuperadmin(
      "root@platform",
      "rootpassword",
    );
    await request(app)
      .post("/admin/tenants/link")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "First", voicelinkClientId: 2000 });
    const res = await request(app)
      .post("/admin/tenants/link")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Second", voicelinkClientId: 2000 });
    expect(res.status).toBe(409);
  });
});

describe("GET /admin/tenants", () => {
  it("lists tenants for superadmin, hiding BYOK keys", async () => {
    const { token } = await _testHelpers.createSuperadmin(
      "root@platform",
      "rootpassword",
    );
    await request(app)
      .post("/admin/tenants/link")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "T1", voicelinkClientId: 3001 });
    await request(app)
      .post("/admin/tenants/link")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "T2", voicelinkClientId: 3002 });
    const res = await request(app)
      .get("/admin/tenants")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.tenants).toHaveLength(2);
    for (const t of res.body.tenants) {
      expect(t.byok).toBeUndefined();
    }
  });
});

describe("tenantScope() invariant", () => {
  it("throws when called without a tenant on the request", () => {
    const fakeReq = { tenantId: undefined } as Parameters<typeof tenantScope>[0];
    expect(() => tenantScope(fakeReq)).toThrow(/without a tenant/i);
  });

  it("returns a filter pre-scoped to the tenant", () => {
    const fakeReq = { tenantId: "abc123" } as Parameters<typeof tenantScope>[0];
    expect(tenantScope(fakeReq, { status: "active" })).toEqual({
      status: "active",
      tenantId: "abc123",
    });
  });
});
