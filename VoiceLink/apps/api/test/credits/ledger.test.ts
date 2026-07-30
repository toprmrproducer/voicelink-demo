import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";

import {
  debitForCall,
  topUp,
  getBalance,
  getLedgerPage,
  CREDIT_RATE_PER_SEC,
} from "../../src/credits/ledger.js";
import { ensureIndexes } from "../../src/db/connection.js";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("vp-credits-test");
  await ensureIndexes(db);
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("credits").deleteMany({});
  await db.collection("credits_ledger").deleteMany({});
});

describe("debitForCall", () => {
  it("subtracts duration * rate from balance and writes a ledger entry", async () => {
    await topUp({ tenantId: "t1", amount: 1000, note: "seed" }, db);
    const result = await debitForCall(
      { tenantId: "t1", callId: "call-1", durationSec: 30 },
      db,
    );
    expect(result.alreadyApplied).toBe(false);
    expect(result.balanceAfter).toBe(1000 - 30 * CREDIT_RATE_PER_SEC);
    expect(await getBalance("t1", db)).toBe(970);

    const entries = await db
      .collection("credits_ledger")
      .find({ tenantId: "t1" })
      .toArray();
    expect(entries).toHaveLength(2); // topup + debit
    const debit = entries.find((e) => e.type === "call");
    expect(debit?.amount).toBe(-30);
    expect(debit?.callId).toBe("call-1");
  });

  it("is idempotent — second debit for the same callId returns alreadyApplied", async () => {
    await topUp({ tenantId: "t2", amount: 500 }, db);
    const a = await debitForCall(
      { tenantId: "t2", callId: "call-2", durationSec: 10 },
      db,
    );
    const b = await debitForCall(
      { tenantId: "t2", callId: "call-2", durationSec: 10 },
      db,
    );
    expect(a.alreadyApplied).toBe(false);
    expect(b.alreadyApplied).toBe(true);
    expect(b.balanceAfter).toBe(a.balanceAfter);
    // Balance must reflect a single debit, not two
    expect(await getBalance("t2", db)).toBe(500 - 10);
    const debits = await db
      .collection("credits_ledger")
      .find({ tenantId: "t2", type: "call" })
      .toArray();
    expect(debits).toHaveLength(1);
  });

  it("allows the balance to go negative (overdraft is a billing concern)", async () => {
    const result = await debitForCall(
      { tenantId: "t-broke", callId: "call-broke", durationSec: 60 },
      db,
    );
    expect(result.alreadyApplied).toBe(false);
    expect(result.balanceAfter).toBe(-60);
    expect(await getBalance("t-broke", db)).toBe(-60);
  });

  it("records a zero-amount call entry for durationSec=0", async () => {
    await topUp({ tenantId: "t-zero", amount: 100 }, db);
    const result = await debitForCall(
      { tenantId: "t-zero", callId: "call-zero", durationSec: 0 },
      db,
    );
    expect(result.alreadyApplied).toBe(false);
    expect(result.balanceAfter).toBe(100);
    const entries = await db
      .collection("credits_ledger")
      .find({ tenantId: "t-zero", type: "call" })
      .toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0].amount).toBe(0);
  });

  it("honors a per-call ratePerSec override", async () => {
    await topUp({ tenantId: "t-rate", amount: 1000 }, db);
    await debitForCall(
      { tenantId: "t-rate", callId: "call-r", durationSec: 10, ratePerSec: 5 },
      db,
    );
    expect(await getBalance("t-rate", db)).toBe(1000 - 10 * 5);
  });
});

describe("topUp", () => {
  it("adds the amount to the running balance", async () => {
    const r1 = await topUp({ tenantId: "t-add", amount: 200 }, db);
    expect(r1.balanceAfter).toBe(200);
    const r2 = await topUp({ tenantId: "t-add", amount: 50 }, db);
    expect(r2.balanceAfter).toBe(250);
  });

  it("rejects negative amounts for type=topup", async () => {
    await expect(
      topUp({ tenantId: "t-neg", amount: -1, type: "topup" }, db),
    ).rejects.toThrow(/non-negative/);
  });

  it("allows negative amounts for type=adjustment (manual correction)", async () => {
    await topUp({ tenantId: "t-adj", amount: 100 }, db);
    const r = await topUp(
      { tenantId: "t-adj", amount: -30, type: "adjustment", note: "fix" },
      db,
    );
    expect(r.balanceAfter).toBe(70);
  });
});

describe("getLedgerPage", () => {
  it("returns balance + entries newest-first, respecting limit", async () => {
    await topUp({ tenantId: "tp", amount: 1000 }, db);
    for (let i = 0; i < 5; i++) {
      // Stagger createdAt so the sort is deterministic; insertOne assigns
      // monotonically increasing ObjectIds but Date resolution is ms.
      await new Promise((r) => setTimeout(r, 3));
      await debitForCall(
        { tenantId: "tp", callId: `c-${i}`, durationSec: 1 },
        db,
      );
    }
    const page = await getLedgerPage("tp", 3, db);
    expect(page.balance).toBe(1000 - 5);
    expect(page.entries).toHaveLength(3);
    // Newest first: c-4, c-3, c-2
    expect(page.entries[0].callId).toBe("c-4");
    expect(page.entries[2].callId).toBe("c-2");
  });

  it("returns 0 + [] for a tenant with no activity", async () => {
    const page = await getLedgerPage("ghost", 50, db);
    expect(page.balance).toBe(0);
    expect(page.entries).toEqual([]);
  });
});
