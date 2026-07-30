import { Router } from "express";
import {
  VoicelinkCallEvent,
  voicelinkToCallStatus,
  type Did,
  type VoicelinkCallEvent as VoicelinkCallEventType,
} from "@voiceplatform/shared";

import { getDb } from "../db/connection.js";
import { createLogger } from "../lib/logger.js";
import { debitForCall, CREDIT_RATE_PER_SEC } from "../credits/ledger.js";
import { verifyVoicelinkWebhook } from "../adapters/telephony/voicelink/signature.js";

const log = createLogger("webhooks");

export const webhooksRouter = Router();

/**
 * POST /webhooks/voicelink
 *
 * Voicelink fires this for every configured call event (Event Type =
 * ringing | answered | completed | failed). The reseller maps the field
 * names in the "Add Call Event API" admin UI — see Architecture.md §2.
 *
 * v1 behavior:
 *   1. Validate the payload against the canonical schema.
 *   2. Append the raw payload to `call_events` (audit trail).
 *   3. Upsert the `calls` row keyed by providerCallId.
 *   4. Return { received: true } so Voicelink stops retrying.
 *
 * Signature verification (Q2) is not yet wired — see verifyWebhook in the
 * TelephonyProvider interface. Mitigation until then: gate this path via
 * IP allow-list at Caddy.
 */
webhooksRouter.post("/voicelink", async (req, res) => {
  const raw = req.body;
  // DIAGNOSTIC: log the exact payload VoiceLink sends so we can see call
  // outcomes (failed/busy/no-answer + reason) and field names.
  log.info({ rawVoicelinkWebhook: raw }, "raw voicelink webhook payload");
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    res.status(400).json({ error: "body must be a JSON object" });
    return;
  }

  // VoiceLink's real webhook (2026) sends { event: "call.*", call: {...} }
  // which differs from the repo's legacy schema. Handle it natively:
  // record every lifecycle event + the call row, and ALWAYS return 200 so
  // VoiceLink doesn't retry.
  const evt = raw as {
    event?: unknown;
    call?: {
      id?: string;
      direction?: string;
      from?: string;
      to?: string;
      status?: string;
      hangupCause?: string | null;
      durationSec?: number | null;
      ringDurationSec?: number | null;
    };
  };
  if (typeof evt.event === "string" && evt.call && typeof evt.call === "object") {
    const c = evt.call;
    const now = new Date();
    const db = getDb();
    const direction: "in" | "out" = c.direction === "outbound" ? "out" : "in";
    const ourDid = direction === "out" ? String(c.from ?? "") : String(c.to ?? "");
    const did = await db.collection<Did>("dids").findOne({ providerNumber: ourDid });
    const statusMap: Record<string, "queued" | "ringing" | "inprogress" | "completed" | "failed"> = {
      initiated: "queued", ringing: "ringing", answered: "inprogress",
      "in-progress": "inprogress", completed: "completed",
      failed: "failed", "no-answer": "failed", busy: "failed", canceled: "failed",
    };
    const status = statusMap[String(c.status)] ?? "ringing";
    await db.collection("call_events").insertOne({
      providerCallId: c.id, eventType: String(evt.event), callStatus: c.status ?? null,
      hangupCause: c.hangupCause ?? null, receivedAt: now, rawPayload: raw as Record<string, unknown>,
    });
    await db.collection("calls").updateOne(
      { providerCallId: c.id },
      {
        $set: {
          direction, fromNumber: String(c.from ?? ""), toNumber: String(c.to ?? ""),
          status, durationSec: c.durationSec ?? 0, updatedAt: now,
        },
        $setOnInsert: {
          providerCallId: c.id, tenantId: did?.tenantId ?? "pending",
          agentId: did?.defaultAgentId ?? "pending", createdAt: now,
          sentiment: "unknown", costCredits: 0, costCogs: 0,
        },
      },
      { upsert: true },
    );
    log.info(
      { providerCallId: c.id, event: evt.event, status, hangupCause: c.hangupCause ?? null },
      "voicelink webhook (v2) recorded",
    );
    res.status(200).json({ received: true });
    return;
  }

  // HMAC verification — passthrough until VOICELINK_WEBHOOK_SECRET is
  // set on VPS-1 (Q2). Fails closed when the secret is configured but
  // the signature header is missing or wrong.
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(raw));
  const sigOk = verifyVoicelinkWebhook(req.headers, rawBody, {
    secret: process.env.VOICELINK_WEBHOOK_SECRET,
    header: process.env.VOICELINK_WEBHOOK_HEADER,
  });
  if (!sigOk) {
    log.warn({ ip: req.ip }, "rejected webhook: bad signature");
    res.status(401).json({ error: "invalid signature" });
    return;
  }

  const parsed = VoicelinkCallEvent.safeParse(raw);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "invalid payload", issues: parsed.error.issues });
    return;
  }

  const event = parsed.data;
  const now = new Date();
  const db = getDb();

  // 1. Append raw event (audit trail, never updated)
  await db.collection("call_events").insertOne({
    providerCallId: event.unique_id,
    eventType: event.event_type,
    callStatus: event.status,
    receivedAt: now,
    rawPayload: raw as Record<string, unknown>,
  });

  // 2. Resolve tenant + agent via DID lookup + custom_parameters parse.
  const did = await db
    .collection<Did>("dids")
    .findOne({ providerNumber: event.virtual_number });
  const customParams = parseCustomParameters(
    (raw as Record<string, unknown>).custom_parameters,
  );
  const resolvedTenantId = did?.tenantId ?? "pending";
  const resolvedAgentId =
    customParams.agentId ?? did?.defaultAgentId ?? "pending";

  // 3. Upsert canonical call row
  const callDoc = buildCallDoc(event, now, {
    tenantId: resolvedTenantId,
    agentId: resolvedAgentId,
    campaignId: customParams.campaignId,
  });
  await db.collection("calls").updateOne(
    { providerCallId: event.unique_id },
    {
      $set: callDoc.set,
      $setOnInsert: callDoc.setOnInsert,
    },
    { upsert: true },
  );

  // 4. Debit credits on terminal events — idempotent on (callId, type)
  //    so Voicelink redelivery of the same completed event is safe.
  //    Skip if we couldn't resolve the tenant (DID not assigned yet);
  //    the backfill on /admin/dids/assign already handles those rows.
  if (
    (callDoc.set.status === "completed" || callDoc.set.status === "failed") &&
    resolvedTenantId !== "pending"
  ) {
    try {
      // Use providerCallId as the ledger callId so retries collide on
      // the same row and we don't double-charge.
      const result = await debitForCall({
        tenantId: resolvedTenantId,
        callId: event.unique_id,
        durationSec: callDoc.set.durationSec,
        note: `${callDoc.set.status} via voicelink`,
      });
      if (!result.alreadyApplied) {
        // Backfill costCredits on the call row so reporting shows the
        // billed amount alongside duration.
        const cost = Math.max(
          0,
          Math.round(callDoc.set.durationSec * CREDIT_RATE_PER_SEC),
        );
        await db
          .collection("calls")
          .updateOne(
            { providerCallId: event.unique_id },
            { $set: { costCredits: cost } },
          );
      }
    } catch (err) {
      log.warn(
        { err, providerCallId: event.unique_id, tenantId: resolvedTenantId },
        "debit failed — call still recorded; reconcile manually",
      );
    }
  }

  log.info(
    {
      providerCallId: event.unique_id,
      eventType: event.event_type,
      status: callDoc.set.status,
      tenantId: resolvedTenantId,
      agentId: resolvedAgentId,
      didResolved: did !== null,
    },
    "voicelink webhook received",
  );

  res.status(200).json({ received: true });
});

interface ResolvedContext {
  tenantId: string;
  agentId: string;
  campaignId?: string;
}

interface CallDocPatch {
  set: {
    direction: "in" | "out";
    fromNumber: string;
    toNumber: string;
    status: "queued" | "ringing" | "inprogress" | "completed" | "failed";
    durationSec: number;
    recordingUrl?: string;
    startedAt?: Date;
    endedAt?: Date;
    updatedAt: Date;
  };
  setOnInsert: {
    providerCallId: string;
    tenantId: string;
    agentId: string;
    campaignId?: string;
    createdAt: Date;
    sentiment: "unknown";
    costCredits: number;
    costCogs: number;
  };
}

function buildCallDoc(
  event: VoicelinkCallEventType,
  now: Date,
  ctx: ResolvedContext,
): CallDocPatch {
  const direction: "in" | "out" =
    event.call_type === "outbound" ? "out" : "in";

  // For outbound calls: we dialed from our DID (virtual_number) → customer.
  // For inbound calls: customer dialed our DID, so the "from" is them.
  const fromNumber =
    direction === "out" ? event.virtual_number : event.customer_number;
  const toNumber =
    direction === "out" ? event.customer_number : event.virtual_number;

  const status = voicelinkToCallStatus(event.event_type, event.status);
  const startedAt = parseCallDate(event.call_date);
  const durationSec = event.duration ?? 0;
  const isTerminal = status === "completed" || status === "failed";
  const endedAt =
    isTerminal && startedAt ? new Date(startedAt.getTime() + durationSec * 1000) : undefined;

  const set: CallDocPatch["set"] = {
    direction,
    fromNumber,
    toNumber,
    status,
    durationSec,
    updatedAt: now,
  };
  if (event.recording_path !== undefined) {
    set.recordingUrl = event.recording_path;
  }
  if (startedAt !== undefined) {
    set.startedAt = startedAt;
  }
  if (endedAt !== undefined) {
    set.endedAt = endedAt;
  }

  const setOnInsert: CallDocPatch["setOnInsert"] = {
    providerCallId: event.unique_id,
    tenantId: ctx.tenantId,
    agentId: ctx.agentId,
    createdAt: now,
    sentiment: "unknown",
    costCredits: 0,
    costCogs: 0,
  };
  if (ctx.campaignId !== undefined) {
    setOnInsert.campaignId = ctx.campaignId;
  }

  return { set, setOnInsert };
}

function parseCallDate(s: string): Date | undefined {
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

/**
 * Parse the `custom_parameters` field from a Voicelink call-event payload.
 *
 * Convention: our campaign engine (P2-B) encodes per-call context as JSON
 * when calling `originateCall`. The reseller (Hardik) maps the
 * `custom_parameters` slot in the Voicelink webhook configurator so it
 * round-trips back to us. Unparseable strings are silently ignored — the
 * caller falls back to DID defaults.
 */
function parseCustomParameters(value: unknown): {
  agentId?: string;
  campaignId?: string;
} {
  if (typeof value !== "string" || value.length === 0) return {};
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: { agentId?: string; campaignId?: string } = {};
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.agentId === "string" && obj.agentId.length > 0) {
      out.agentId = obj.agentId;
    }
    if (typeof obj.campaignId === "string" && obj.campaignId.length > 0) {
      out.campaignId = obj.campaignId;
    }
    return out;
  } catch {
    return {};
  }
}
