import type { Server as HTTPServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocketServer, type WebSocket } from "ws";
import { ObjectId } from "mongodb";

import type { Agent, Call, Did } from "@voiceplatform/shared";

import { getDb } from "../db/connection.js";
import { createLogger } from "../lib/logger.js";
import { realtimeForAgent } from "./realtime-factory.js";
import { CallSession, type StartFrameInfo } from "./session-manager.js";

const log = createLogger("ws-router");

const VOICELINK_PATH = /^\/ws\/voicelink\/([a-zA-Z0-9_-]+)$/;

export interface MountOptions {
  /** Override for tests — by default the router uses realtimeForAgent. */
  realtimeFactory?: (agent: Agent) => ReturnType<typeof realtimeForAgent>;
  /** Override for tests — by default the router uses the global Mongo db. */
  db?: ReturnType<typeof getDb>;
}

/**
 * Attach a WS upgrade handler to the given HTTP server. Voicelink (and
 * any future telephony provider that registers a per-DID WS bot) opens
 * a socket at:
 *
 *   wss://api.auto4you.in/ws/voicelink/<didId>[?callId=<our-call-id>]
 *
 * Routing rules:
 *   1. Path must match /ws/voicelink/:didId. Anything else → socket
 *      destroyed before upgrade.
 *   2. The DID must exist in our `dids` collection. If not, destroyed
 *      (a stale bot URL Voicelink kept after we revoked the link).
 *   3. Outbound path (callId query param present): we look up the
 *      pre-created call row to get tenantId + agentId. Provider boots
 *      immediately because identity is already known.
 *   4. Inbound path (no callId): we accept the upgrade with the DID's
 *      defaultAgentId, and wait for the {event:"start"} frame to learn
 *      the providerCallId. If defaultAgentId is missing, we close —
 *      admin needs to set one before inbound calls can land.
 *
 * The returned `WebSocketServer` is exposed for tests that want to
 * inspect connection state. Production code should not need it.
 */
export function mountCallWsRouter(
  server: HTTPServer,
  opts: MountOptions = {},
): WebSocketServer {
  const factory = opts.realtimeFactory ?? realtimeForAgent;
  const db = () => opts.db ?? getDb();
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const m = VOICELINK_PATH.exec(url.pathname);
    if (!m) {
      log.warn({ path: url.pathname }, "rejected upgrade: bad path");
      socket.destroy();
      return;
    }
    const didId = m[1]!;
    const callIdParam = url.searchParams.get("callId");

    try {
      const did = await db().collection<Did>("dids").findOne({ _id: didId });
      if (!did) {
        log.warn({ didId }, "rejected upgrade: unknown DID");
        socket.destroy();
        return;
      }

      // Resolve initial agent. Outbound path has the call already
      // inserted (campaign-engine pre-creates it); inbound falls back
      // to the DID's default.
      let agentId = did.defaultAgentId;
      let callId = callIdParam ?? undefined;

      if (callIdParam) {
        const call = await db()
          .collection<Call>("calls")
          .findOne({ _id: callIdParam });
        if (call && call.tenantId === did.tenantId) {
          agentId = call.agentId;
        } else {
          log.warn(
            { callId: callIdParam, didId },
            "outbound upgrade with unknown/cross-tenant callId — using DID default",
          );
        }
      }

      if (!agentId) {
        log.warn({ didId }, "rejected upgrade: no agent (inbound with no defaultAgentId)");
        socket.destroy();
        return;
      }

      const agent = await db()
        .collection<Agent>("agents")
        .findOne({ _id: agentId, tenantId: did.tenantId });
      if (!agent) {
        log.warn({ agentId, tenantId: did.tenantId }, "rejected upgrade: agent missing");
        socket.destroy();
        return;
      }

      // Synthetic callId for inbound until the start frame arrives — it
      // gets overwritten by the real providerCallId in onStartFrame.
      if (!callId) callId = new ObjectId().toString();

      wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        startSession({
          ws,
          did,
          agent,
          callId: callId!,
          factory,
          waitForStartFrame: !callIdParam,
        });
      });
    } catch (err) {
      log.error({ err, didId }, "upgrade failed");
      socket.destroy();
    }
  });

  return wss;
}

function startSession(args: {
  ws: WebSocket;
  did: Did;
  agent: Agent;
  callId: string;
  factory: (agent: Agent) => ReturnType<typeof realtimeForAgent>;
  waitForStartFrame: boolean;
}): void {
  const { ws, did, agent, callId, factory, waitForStartFrame } = args;

  let provider;
  try {
    provider = factory(agent);
  } catch (err) {
    log.error(
      { err, agentId: agent._id, tenantId: did.tenantId },
      "realtime factory failed — closing socket",
    );
    ws.close(1011, "realtime provider init failed");
    return;
  }

  const onStartFrame = async (info: StartFrameInfo): Promise<void> => {
    // Inbound: backfill providerCallId so the webhook receiver's upsert
    // matches the row we (will) create here. Outbound: confirm the
    // providerCallId Voicelink reports matches what we expect.
    if (!info.providerCallId) return;
    try {
      await getDb()
        .collection<Call>("calls")
        .updateOne(
          { _id: callId },
          {
            $set: {
              providerCallId: info.providerCallId,
              status: "inprogress",
              updatedAt: new Date(),
            },
            $setOnInsert: {
              _id: callId,
              tenantId: did.tenantId,
              agentId: agent._id,
              direction: "in",
              fromNumber: info.customParameters?.from ?? "unknown",
              toNumber: did.providerNumber,
              durationSec: 0,
              sentiment: "unknown",
              costCredits: 0,
              costCogs: 0,
              createdAt: new Date(),
            },
          },
          { upsert: true },
        );
    } catch (err) {
      log.warn({ err, callId }, "failed to backfill call row from start frame");
    }
  };

  // Voicelink (Twilio-compatible) carries µ-law 8 kHz on the WS;
  // OpenAI Realtime + Gemini Live both speak PCM16 24 kHz. The session
  // bridges between the two unless we're using the fake provider in
  // tests (which round-trips bytes for echo).
  const audioFormat: "passthrough" | "mulaw8k-pcm16_24k" =
    process.env.REALTIME_MODE === "fake" ? "passthrough" : "mulaw8k-pcm16_24k";

  const session = new CallSession(ws, {
    callId,
    provider,
    greeting: agent.greeting,
    waitForStartFrame,
    onStartFrame,
    audioFormat,
  });

  session.start().catch((err) => {
    log.error({ err, callId }, "session start failed");
    ws.close(1011, "session start failed");
  });

  log.info(
    {
      callId,
      didId: did._id,
      tenantId: did.tenantId,
      agentId: agent._id,
      direction: waitForStartFrame ? "in" : "out",
    },
    "call session started",
  );
}
