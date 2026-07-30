import { ObjectId, type Db } from "mongodb";

import type {
  Credits,
  CreditsLedgerEntry,
  LedgerType,
} from "@voiceplatform/shared";

import { getDb } from "../db/connection.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("credits");

/**
 * Flat platform rate: 1 credit per second of completed talk time.
 * Per-tenant or per-plan overrides land when we have pricing tiers.
 */
export const CREDIT_RATE_PER_SEC = 1;

export interface DebitForCallInput {
  tenantId: string;
  callId: string;
  durationSec: number;
  /** Override the platform default. */
  ratePerSec?: number;
  note?: string;
}

export interface LedgerWriteResult {
  /** True if this call had already been debited — no balance change. */
  alreadyApplied: boolean;
  /** Balance after the write (or current balance if alreadyApplied). */
  balanceAfter: number;
  /** The ledger entry id (existing one if idempotent). */
  ledgerId: string;
}

/**
 * Charge a tenant for a completed call. Idempotent on (callId, type="call"):
 * a second invocation for the same callId is a no-op and returns the
 * existing balance. Safe to retry on webhook redelivery.
 *
 * Returns `alreadyApplied: true` when a prior debit exists. Negative
 * balances are allowed — overdraft is a billing concern, not a system
 * error; admins resolve via topUp or adjustment.
 */
export async function debitForCall(
  input: DebitForCallInput,
  database: Db = getDb(),
): Promise<LedgerWriteResult> {
  if (input.durationSec <= 0) {
    // Zero-duration call = no debit (failed dial, no-answer, etc).
    // Still record it as a "call" ledger with amount 0 so reporting
    // shows we saw the completion.
    return writeLedger(database, {
      tenantId: input.tenantId,
      callId: input.callId,
      type: "call",
      amount: 0,
      note: input.note ?? "zero-duration",
    });
  }
  const rate = input.ratePerSec ?? CREDIT_RATE_PER_SEC;
  const amount = -Math.round(input.durationSec * rate);
  return writeLedger(database, {
    tenantId: input.tenantId,
    callId: input.callId,
    type: "call",
    amount,
    note: input.note,
  });
}

export interface TopUpInput {
  tenantId: string;
  amount: number;
  type?: Extract<LedgerType, "topup" | "refund" | "adjustment">;
  /** Optional callId — pin a refund to the call it relates to. */
  callId?: string;
  note?: string;
}

/**
 * Add credits to a tenant. Used by admin top-ups, refunds, and manual
 * adjustments. `amount` may be negative for adjustments that reduce
 * balance (e.g. correcting a prior over-grant); for that case use
 * `type: "adjustment"`. Top-ups/refunds must be non-negative.
 */
export async function topUp(
  input: TopUpInput,
  database: Db = getDb(),
): Promise<LedgerWriteResult> {
  const type = input.type ?? "topup";
  if ((type === "topup" || type === "refund") && input.amount < 0) {
    throw new Error(
      `topUp(type=${type}) requires non-negative amount; got ${input.amount}`,
    );
  }
  return writeLedger(database, {
    tenantId: input.tenantId,
    callId: input.callId,
    type,
    amount: input.amount,
    note: input.note,
  });
}

/** Read the current balance. Returns 0 if no credits row exists yet. */
export async function getBalance(
  tenantId: string,
  database: Db = getDb(),
): Promise<number> {
  const row = await database
    .collection<Credits>("credits")
    .findOne({ tenantId });
  return row?.balance ?? 0;
}

export interface LedgerPage {
  balance: number;
  entries: CreditsLedgerEntry[];
}

/** Last N ledger entries (most recent first) + current balance. */
export async function getLedgerPage(
  tenantId: string,
  limit = 50,
  database: Db = getDb(),
): Promise<LedgerPage> {
  const [balance, entries] = await Promise.all([
    getBalance(tenantId, database),
    database
      .collection<CreditsLedgerEntry>("credits_ledger")
      .find({ tenantId })
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(500, limit)))
      .toArray(),
  ]);
  return { balance, entries };
}

interface WriteLedgerInput {
  tenantId: string;
  callId?: string;
  type: LedgerType;
  amount: number;
  note?: string;
}

async function writeLedger(
  database: Db,
  input: WriteLedgerInput,
): Promise<LedgerWriteResult> {
  // Apply the delta atomically and read back the new balance. Mongo
  // upserts the credits row if missing.
  const updated = await database
    .collection<Credits>("credits")
    .findOneAndUpdate(
      { tenantId: input.tenantId },
      {
        $inc: { balance: input.amount },
        $set: { updatedAt: new Date() },
        $setOnInsert: { _id: input.tenantId, tenantId: input.tenantId, unit: "minutes" },
      },
      { upsert: true, returnDocument: "after" },
    );

  const balanceAfter = updated?.balance ?? input.amount;

  const entry: CreditsLedgerEntry = {
    _id: new ObjectId().toString(),
    tenantId: input.tenantId,
    type: input.type,
    amount: input.amount,
    balanceAfter,
    createdAt: new Date(),
    ...(input.callId !== undefined ? { callId: input.callId } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
  };

  try {
    await database.collection<CreditsLedgerEntry>("credits_ledger").insertOne(entry);
    return { alreadyApplied: false, balanceAfter, ledgerId: entry._id };
  } catch (err) {
    // Duplicate-key error from the partial unique index on (callId, type)
    // means another worker already wrote this debit. Roll back the
    // balance delta and return the existing entry's balanceAfter.
    if (
      isMongoDuplicateKey(err) &&
      input.callId !== undefined
    ) {
      await database
        .collection<Credits>("credits")
        .updateOne(
          { tenantId: input.tenantId },
          {
            $inc: { balance: -input.amount },
            $set: { updatedAt: new Date() },
          },
        );
      const existing = await database
        .collection<CreditsLedgerEntry>("credits_ledger")
        .findOne({ callId: input.callId, type: input.type });
      log.info(
        { tenantId: input.tenantId, callId: input.callId, type: input.type },
        "ledger entry already exists — debit idempotent",
      );
      return {
        alreadyApplied: true,
        balanceAfter: existing?.balanceAfter ?? balanceAfter,
        ledgerId: existing?._id ?? entry._id,
      };
    }
    throw err;
  }
}

function isMongoDuplicateKey(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: number }).code === 11000
  );
}
