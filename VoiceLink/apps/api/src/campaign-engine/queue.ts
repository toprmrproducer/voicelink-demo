import { Queue, Worker, type JobsOptions } from "bullmq";

import { getDb } from "../db/connection.js";
import { createLogger } from "../lib/logger.js";
import { createVoicelinkProvider } from "../adapters/telephony/voicelink/index.js";
import { dialNextLead, pacingIntervalMs } from "./runner.js";
import type { Call, Campaign } from "@voiceplatform/shared";

const log = createLogger("campaign-queue");
const QUEUE_NAME = "campaign-dialer";

interface DialJobData {
  campaignId: string;
  tenantId: string;
}

let queue: Queue<DialJobData> | null = null;
let worker: Worker<DialJobData> | null = null;

function redisConnection(): { url: string } | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  return { url };
}

/** Lazily creates the BullMQ queue. Returns null when REDIS_URL is unset. */
export function getDialQueue(): Queue<DialJobData> | null {
  const conn = redisConnection();
  if (!conn) return null;
  if (!queue) {
    queue = new Queue<DialJobData>(QUEUE_NAME, { connection: conn });
  }
  return queue;
}

/**
 * Enqueue the next dial for a campaign. The worker picks it up, runs
 * one originate, and schedules the following tick at the pacing
 * interval. Returns false (no-op) when Redis is not configured —
 * callers in dev mode can rely on /campaigns/:id/dial-now for manual
 * single-shot dials in that case.
 */
export async function enqueueNextDial(
  campaignId: string,
  tenantId: string,
  delayMs = 0,
): Promise<boolean> {
  const q = getDialQueue();
  if (!q) return false;
  const opts: JobsOptions = {
    delay: Math.max(0, delayMs),
    removeOnComplete: 100,
    removeOnFail: 100,
  };
  await q.add("dial", { campaignId, tenantId }, opts);
  return true;
}

/**
 * Starts the dialer worker. Idempotent. Called once at api startup
 * when REDIS_URL is set. Worker pulls one job at a time per process
 * (concurrency=1) so pacing is global per worker — scale by running
 * more api containers, not more workers per container.
 */
export function startDialWorker(): Worker<DialJobData> | null {
  const conn = redisConnection();
  if (!conn) return null;
  if (worker) return worker;
  worker = new Worker<DialJobData>(
    QUEUE_NAME,
    async (job) => {
      const { campaignId, tenantId } = job.data;
      const db = getDb();
      const result = await dialNextLead(campaignId, tenantId, {
        telephony: createVoicelinkProvider(),
        campaigns: db.collection<Campaign>("campaigns"),
        calls: db.collection<Call>("calls"),
        dids: db.collection("dids"),
        wsBaseUrl: process.env.WS_BASE_URL,
      });
      log.info(
        { campaignId, status: result.status, cursor: result.campaign.cursor },
        "dial tick",
      );
      if (result.status === "dialed") {
        // Re-enqueue self at the pacing interval.
        const interval = pacingIntervalMs(
          result.campaign.schedule.pacingCallsPerMinute,
        );
        await enqueueNextDial(campaignId, tenantId, interval);
      }
      return result;
    },
    { connection: conn, concurrency: 1 },
  );
  worker.on("failed", (job, err) => {
    log.error({ err, jobId: job?.id }, "dial worker failed");
  });
  log.info({ queue: QUEUE_NAME }, "dial worker started");
  return worker;
}

export async function stopDialWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
