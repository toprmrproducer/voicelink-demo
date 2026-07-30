import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db, type Collection } from "mongodb";
import { ObjectId } from "mongodb";

import type {
  Call,
  Campaign,
  Did,
} from "@voiceplatform/shared";

import {
  dialNextLead,
  pacingIntervalMs,
} from "../../src/campaign-engine/runner.js";
import type {
  CallHandle,
  OutboundCallInput,
  TelephonyProvider,
} from "../../src/adapters/telephony/types.js";

class FakeTelephony implements TelephonyProvider {
  readonly name = "voicelink" as const;
  public calls: OutboundCallInput[] = [];
  public failNext = false;

  async originateCall(input: OutboundCallInput): Promise<CallHandle> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("provider boom");
    }
    this.calls.push(input);
    return {
      providerCallId: `prov-${this.calls.length}`,
      acceptedAt: new Date(),
    };
  }
  async bulkOriginate(): Promise<CallHandle[]> {
    throw new Error("not used by this test");
  }
  async registerWSBot(): Promise<{ botId: string }> {
    throw new Error("not used");
  }
  async getCallStatus(): Promise<{ status: "queued" }> {
    return { status: "queued" };
  }
  verifyWebhook(): boolean {
    return true;
  }
}

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let campaigns: Collection<Campaign>;
let calls: Collection<Call>;
let dids: Collection<Did>;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("vp-runner-test");
  campaigns = db.collection<Campaign>("campaigns");
  calls = db.collection<Call>("calls");
  dids = db.collection<Did>("dids");
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await campaigns.deleteMany({});
  await calls.deleteMany({});
  await dids.deleteMany({});
});

const TENANT = "tenant-1";

async function seedCampaign(overrides: Partial<Campaign> = {}): Promise<Campaign> {
  const id = new ObjectId().toString();
  const now = new Date();
  const campaign: Campaign = {
    _id: id,
    tenantId: TENANT,
    agentId: "agent-1",
    fromDid: "+919999999999",
    name: "test",
    schedule: {
      startAt: now,
      timezone: "Asia/Kolkata",
      pacingCallsPerMinute: 60,
      retries: 0,
    },
    numbers: [
      { phone: "+919811111111", customData: {} },
      { phone: "+919811111112", customData: {} },
    ],
    status: "running",
    stats: { total: 2, dialed: 0, connected: 0, succeeded: 0, failed: 0 },
    cursor: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await campaigns.insertOne(campaign);
  return campaign;
}

describe("pacingIntervalMs", () => {
  it("computes ms per call from calls/minute", () => {
    expect(pacingIntervalMs(60)).toBe(1000);
    expect(pacingIntervalMs(120)).toBe(500);
    expect(pacingIntervalMs(1)).toBe(60_000);
  });

  it("clamps invalid rates to a safe default", () => {
    expect(pacingIntervalMs(0)).toBe(60_000);
    expect(pacingIntervalMs(-10)).toBe(60_000);
  });
});

describe("dialNextLead", () => {
  it("dials the next lead and advances the cursor", async () => {
    await seedCampaign({ _id: "c1" });
    const tele = new FakeTelephony();
    const result = await dialNextLead("c1", TENANT, {
      telephony: tele,
      campaigns,
      calls,
      dids,
    });
    expect(result.status).toBe("dialed");
    expect(tele.calls).toHaveLength(1);
    expect(tele.calls[0].toNumber).toBe("+919811111111");

    const after = await campaigns.findOne({ _id: "c1" });
    expect(after?.cursor).toBe(1);
    expect(after?.stats.dialed).toBe(1);

    const callDocs = await calls.find({ campaignId: "c1" }).toArray();
    expect(callDocs).toHaveLength(1);
    expect(callDocs[0].status).toBe("ringing");
    expect(callDocs[0].tenantId).toBe(TENANT);
  });

  it("returns no-more-leads + marks done when cursor passes end", async () => {
    await seedCampaign({ _id: "c2", cursor: 2 });
    const tele = new FakeTelephony();
    const result = await dialNextLead("c2", TENANT, {
      telephony: tele,
      campaigns,
      calls,
      dids,
    });
    expect(result.status).toBe("no-more-leads");
    expect(tele.calls).toHaveLength(0);
    const after = await campaigns.findOne({ _id: "c2" });
    expect(after?.status).toBe("done");
  });

  it("returns paused for non-running campaigns and does not dial", async () => {
    await seedCampaign({ _id: "c3", status: "paused" });
    const tele = new FakeTelephony();
    const result = await dialNextLead("c3", TENANT, {
      telephony: tele,
      campaigns,
      calls,
      dids,
    });
    expect(result.status).toBe("paused");
    expect(tele.calls).toHaveLength(0);
  });

  it("returns no-did when fromDid is unset", async () => {
    await seedCampaign({ _id: "c4", fromDid: undefined });
    const tele = new FakeTelephony();
    const result = await dialNextLead("c4", TENANT, {
      telephony: tele,
      campaigns,
      calls,
      dids,
    });
    expect(result.status).toBe("no-did");
    expect(tele.calls).toHaveLength(0);
  });

  it("records a failed call when originate throws but still advances cursor", async () => {
    await seedCampaign({ _id: "c5" });
    const tele = new FakeTelephony();
    tele.failNext = true;
    const result = await dialNextLead("c5", TENANT, {
      telephony: tele,
      campaigns,
      calls,
      dids,
    });
    expect(result.status).toBe("dialed");
    const callDocs = await calls.find({ campaignId: "c5" }).toArray();
    expect(callDocs).toHaveLength(1);
    expect(callDocs[0].status).toBe("failed");
    const after = await campaigns.findOne({ _id: "c5" });
    expect(after?.cursor).toBe(1);
    expect(after?.stats.failed).toBe(1);
  });

  it("rejects cross-tenant campaign lookup", async () => {
    await seedCampaign({ _id: "c6" });
    const tele = new FakeTelephony();
    await expect(
      dialNextLead("c6", "wrong-tenant", { telephony: tele, campaigns, calls, dids }),
    ).rejects.toThrow(/not found/);
  });

  it("forwards tenantId + agentId + callId in customParameters", async () => {
    await seedCampaign({ _id: "c7" });
    const tele = new FakeTelephony();
    await dialNextLead("c7", TENANT, { telephony: tele, campaigns, calls, dids });
    const params = JSON.parse(tele.calls[0].customParameters ?? "{}");
    expect(params.tenantId).toBe(TENANT);
    expect(params.agentId).toBe("agent-1");
    expect(params.campaignId).toBe("c7");
    expect(typeof params.callId).toBe("string");
  });

  it("passes per-call websocketUrl when DID is registered + wsBaseUrl is set", async () => {
    await seedCampaign({ _id: "c8" });
    await dids.insertOne({
      _id: "did-8",
      tenantId: TENANT,
      provider: "voicelink",
      providerNumber: "+919999999999",
      didType: "mobile",
      status: "active",
      assignedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const tele = new FakeTelephony();
    await dialNextLead("c8", TENANT, {
      telephony: tele,
      campaigns,
      calls,
      dids,
      wsBaseUrl: "wss://api.example.com",
    });
    const url = tele.calls[0].websocketUrl;
    expect(url).toMatch(
      /^wss:\/\/api\.example\.com\/ws\/voicelink\/did-8\?callId=[a-f0-9]+$/,
    );
  });

  it("omits websocketUrl when DID row is missing (still dials)", async () => {
    await seedCampaign({ _id: "c9" });
    const tele = new FakeTelephony();
    const result = await dialNextLead("c9", TENANT, {
      telephony: tele,
      campaigns,
      calls,
      dids,
      wsBaseUrl: "wss://api.example.com",
    });
    expect(result.status).toBe("dialed");
    expect(tele.calls[0].websocketUrl).toBeUndefined();
  });

  it("omits websocketUrl when wsBaseUrl is unset (dev/test default)", async () => {
    await seedCampaign({ _id: "c10" });
    await dids.insertOne({
      _id: "did-10",
      tenantId: TENANT,
      provider: "voicelink",
      providerNumber: "+919999999999",
      didType: "mobile",
      status: "active",
      assignedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const tele = new FakeTelephony();
    await dialNextLead("c10", TENANT, { telephony: tele, campaigns, calls, dids });
    expect(tele.calls[0].websocketUrl).toBeUndefined();
  });
});
