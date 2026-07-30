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
  for (const c of ["users", "tenants", "agents", "campaigns"]) {
    await getDb().collection(c).deleteMany({});
  }
});

let providerClientIdSeq = 10_000;

/** Seed a tenant + a regular (non-superadmin) owner. Returns token + tenantId. */
async function seedTenantAndOwner(
  email = "owner@example.com",
): Promise<{ token: string; tenantId: string; userId: string }> {
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
    passwordHash: "irrelevant",
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
  return { token, tenantId, userId };
}

/** Minimal valid CreateAgentInput body. */
function validAgentBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Sales Bot",
    voice: {
      provider: "elevenlabs",
      providerVoiceId: "rachel",
    },
    llm: {
      realtimeModel: "gpt-4o-mini-realtime",
      temperature: 0.7,
    },
    ...overrides,
  };
}

describe("POST /agents", () => {
  it("creates an agent scoped to the caller's tenant", async () => {
    const { token, tenantId } = await seedTenantAndOwner();
    const res = await request(app)
      .post("/agents")
      .set("Authorization", `Bearer ${token}`)
      .send(validAgentBody());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      tenantId,
      name: "Sales Bot",
      status: "draft",
      voice: { provider: "elevenlabs", providerVoiceId: "rachel" },
    });
    expect(res.body._id).toBeTruthy();
    const stored = await getDb()
      .collection("agents")
      .findOne({ _id: res.body._id });
    expect(stored?.tenantId).toBe(tenantId);
  });

  it("ignores any tenantId in the request body — caller cannot re-tenant", async () => {
    const { token, tenantId } = await seedTenantAndOwner();
    const otherTenantId = new ObjectId().toString();
    const res = await request(app)
      .post("/agents")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validAgentBody(), tenantId: otherTenantId });
    expect(res.status).toBe(201);
    expect(res.body.tenantId).toBe(tenantId);
  });

  it("returns 400 on invalid input (missing voice)", async () => {
    const { token } = await seedTenantAndOwner();
    const res = await request(app)
      .post("/agents")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "No Voice" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when temperature is out of range", async () => {
    const { token } = await seedTenantAndOwner();
    const res = await request(app)
      .post("/agents")
      .set("Authorization", `Bearer ${token}`)
      .send(
        validAgentBody({
          llm: { realtimeModel: "gpt-4o-mini-realtime", temperature: 5 },
        }),
      );
    expect(res.status).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const res = await request(app).post("/agents").send(validAgentBody());
    expect(res.status).toBe(401);
  });
});

describe("GET /agents", () => {
  it("lists only the caller's tenant agents", async () => {
    const { token, tenantId } = await seedTenantAndOwner();
    const { token: otherToken } = await seedTenantAndOwner("other@example.com");

    await request(app)
      .post("/agents")
      .set("Authorization", `Bearer ${token}`)
      .send(validAgentBody({ name: "Mine A" }));
    await request(app)
      .post("/agents")
      .set("Authorization", `Bearer ${token}`)
      .send(validAgentBody({ name: "Mine B" }));
    await request(app)
      .post("/agents")
      .set("Authorization", `Bearer ${otherToken}`)
      .send(validAgentBody({ name: "Theirs" }));

    const res = await request(app)
      .get("/agents")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.agents).toHaveLength(2);
    for (const a of res.body.agents) {
      expect(a.tenantId).toBe(tenantId);
    }
    expect(res.body.agents.map((a: { name: string }) => a.name).sort()).toEqual([
      "Mine A",
      "Mine B",
    ]);
  });

  it("returns an empty list when the tenant has no agents", async () => {
    const { token } = await seedTenantAndOwner();
    const res = await request(app)
      .get("/agents")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.agents).toEqual([]);
  });
});

describe("GET /agents/:id", () => {
  it("returns an agent owned by the caller's tenant", async () => {
    const { token } = await seedTenantAndOwner();
    const created = await request(app)
      .post("/agents")
      .set("Authorization", `Bearer ${token}`)
      .send(validAgentBody());
    const res = await request(app)
      .get(`/agents/${created.body._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body._id).toBe(created.body._id);
  });

  it("returns 404 for another tenant's agent (no cross-tenant leak)", async () => {
    const { token } = await seedTenantAndOwner();
    const { token: otherToken } = await seedTenantAndOwner("other@example.com");
    const theirs = await request(app)
      .post("/agents")
      .set("Authorization", `Bearer ${otherToken}`)
      .send(validAgentBody({ name: "Theirs" }));
    const res = await request(app)
      .get(`/agents/${theirs.body._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for a non-existent id", async () => {
    const { token } = await seedTenantAndOwner();
    const res = await request(app)
      .get(`/agents/${new ObjectId().toString()}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe("PUT /agents/:id", () => {
  it("updates a field and bumps updatedAt", async () => {
    const { token } = await seedTenantAndOwner();
    const created = await request(app)
      .post("/agents")
      .set("Authorization", `Bearer ${token}`)
      .send(validAgentBody());
    const before = new Date(created.body.updatedAt).getTime();

    // Wait 1ms to ensure updatedAt actually moves
    await new Promise((r) => setTimeout(r, 5));

    const res = await request(app)
      .put(`/agents/${created.body._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Renamed" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed");
    expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThan(before);
  });

  it("refuses to re-tenant an agent — tenantId in body is silently ignored", async () => {
    const { token, tenantId } = await seedTenantAndOwner();
    const created = await request(app)
      .post("/agents")
      .set("Authorization", `Bearer ${token}`)
      .send(validAgentBody());
    const res = await request(app)
      .put(`/agents/${created.body._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ tenantId: new ObjectId().toString(), name: "Renamed" });
    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe(tenantId);
  });

  it("returns 404 for another tenant's agent", async () => {
    const { token } = await seedTenantAndOwner();
    const { token: otherToken } = await seedTenantAndOwner("other@example.com");
    const theirs = await request(app)
      .post("/agents")
      .set("Authorization", `Bearer ${otherToken}`)
      .send(validAgentBody({ name: "Theirs" }));
    const res = await request(app)
      .put(`/agents/${theirs.body._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "hijacked" });
    expect(res.status).toBe(404);
  });

  it("returns 400 on invalid input (bad voice provider)", async () => {
    const { token } = await seedTenantAndOwner();
    const created = await request(app)
      .post("/agents")
      .set("Authorization", `Bearer ${token}`)
      .send(validAgentBody());
    const res = await request(app)
      .put(`/agents/${created.body._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ voice: { provider: "not-a-provider", providerVoiceId: "x" } });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /agents/:id", () => {
  it("deletes an agent that isn't referenced by any campaign", async () => {
    const { token } = await seedTenantAndOwner();
    const created = await request(app)
      .post("/agents")
      .set("Authorization", `Bearer ${token}`)
      .send(validAgentBody());
    const res = await request(app)
      .delete(`/agents/${created.body._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);
    const after = await getDb()
      .collection("agents")
      .findOne({ _id: created.body._id });
    expect(after).toBeNull();
  });

  it("returns 409 when an active (running) campaign references the agent", async () => {
    const { token, tenantId } = await seedTenantAndOwner();
    const created = await request(app)
      .post("/agents")
      .set("Authorization", `Bearer ${token}`)
      .send(validAgentBody());

    await getDb().collection("campaigns").insertOne({
      _id: new ObjectId().toString(),
      tenantId,
      agentId: created.body._id,
      name: "Live Campaign",
      status: "running",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .delete(`/agents/${created.body._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body.campaigns).toBe(1);
  });

  it("returns 409 when a paused campaign references the agent", async () => {
    const { token, tenantId } = await seedTenantAndOwner();
    const created = await request(app)
      .post("/agents")
      .set("Authorization", `Bearer ${token}`)
      .send(validAgentBody());

    await getDb().collection("campaigns").insertOne({
      _id: new ObjectId().toString(),
      tenantId,
      agentId: created.body._id,
      name: "Paused",
      status: "paused",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .delete(`/agents/${created.body._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
  });

  it("allows delete when only draft/done campaigns reference the agent", async () => {
    const { token, tenantId } = await seedTenantAndOwner();
    const created = await request(app)
      .post("/agents")
      .set("Authorization", `Bearer ${token}`)
      .send(validAgentBody());

    await getDb().collection("campaigns").insertMany([
      {
        _id: new ObjectId().toString(),
        tenantId,
        agentId: created.body._id,
        name: "Draft",
        status: "draft",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: new ObjectId().toString(),
        tenantId,
        agentId: created.body._id,
        name: "Finished",
        status: "done",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await request(app)
      .delete(`/agents/${created.body._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);
  });

  it("ignores running campaigns in OTHER tenants when guarding (still deletes)", async () => {
    const { token, tenantId } = await seedTenantAndOwner();
    const created = await request(app)
      .post("/agents")
      .set("Authorization", `Bearer ${token}`)
      .send(validAgentBody());

    // A different tenant somehow has a campaign with the same agentId string —
    // shouldn't block our delete because the guard is tenant-scoped.
    await getDb().collection("campaigns").insertOne({
      _id: new ObjectId().toString(),
      tenantId: new ObjectId().toString(),
      agentId: created.body._id,
      name: "Other tenant",
      status: "running",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .delete(`/agents/${created.body._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);
  });

  it("returns 404 for another tenant's agent", async () => {
    const { token } = await seedTenantAndOwner();
    const { token: otherToken } = await seedTenantAndOwner("other@example.com");
    const theirs = await request(app)
      .post("/agents")
      .set("Authorization", `Bearer ${otherToken}`)
      .send(validAgentBody({ name: "Theirs" }));
    const res = await request(app)
      .delete(`/agents/${theirs.body._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
