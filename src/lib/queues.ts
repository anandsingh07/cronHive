import { Queue, type QueueOptions, type ConnectionOptions, type JobsOptions } from "bullmq";
import type { Job } from "@prisma/client";
import { loadEnv } from "../config/env.js";

// BullMQ disallows ":" in queue names (it uses ":" internally for Redis key structure),
// so namespacing is done via the `prefix` option below rather than in the name itself.
export const QUEUE_PREFIX = "cronhive";
export const QUEUE_EXECUTION = "execution";
export const QUEUE_DEAD_LETTER = "deadletter";

export interface ExecutionJobData {
  executionId: string;
  jobId: string;
  /**
   * The cron fire-slot this execution belongs to, as epoch ms, or "manual".
   * Carried through so the worker can manage the matching fast-path lock if needed.
   */
  fireSlot: number | "manual";
}

export interface DeadLetterJobData {
  executionId: string;
  jobId: string;
  reason: string;
  lastError?: string;
}

/**
 * BullMQ requires an ioredis connection with maxRetriesPerRequest set to null.
 * We build a connection options object (BullMQ creates/manages the client) rather
 * than sharing the app's singleton, so queue blocking commands don't interfere
 * with regular Redis usage.
 */
export function buildConnection(): ConnectionOptions {
  const { REDIS_URL } = loadEnv();
  const isTls = REDIS_URL.startsWith("rediss://");
  return {
    url: REDIS_URL,
    maxRetriesPerRequest: null,
    ...(isTls ? { tls: {} } : {}),
  } as ConnectionOptions;
}

function queueOptions(): QueueOptions {
  return {
    connection: buildConnection(),
    prefix: QUEUE_PREFIX,
    defaultJobOptions: {
      // Keep the queue tidy; completed jobs are recorded in Postgres, not Redis.
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  };
}

let executionQ: Queue<ExecutionJobData> | null = null;
let deadLetterQ: Queue<DeadLetterJobData> | null = null;

export function getExecutionQueue(): Queue<ExecutionJobData> {
  if (!executionQ) executionQ = new Queue<ExecutionJobData>(QUEUE_EXECUTION, queueOptions());
  return executionQ;
}

export function getDeadLetterQueue(): Queue<DeadLetterJobData> {
  if (!deadLetterQ) deadLetterQ = new Queue<DeadLetterJobData>(QUEUE_DEAD_LETTER, queueOptions());
  return deadLetterQ;
}

/**
 * Translate a job's retry policy into BullMQ job options. This is the single source of
 * truth for retry behaviour now that BullMQ owns retries natively:
 *  - attempts = maxRetries + 1 (the initial try plus N retries)
 *  - exponential backoff seeded from the job's backoffMs
 * BullMQ will re-run the processor up to `attempts` times when it throws, applying the
 * backoff between attempts — replacing the old hand-rolled retry queue.
 */
export function executionJobOptions(job: Pick<Job, "maxRetries" | "backoffMs">): JobsOptions {
  return {
    attempts: job.maxRetries + 1,
    backoff: { type: "exponential", delay: job.backoffMs },
  };
}

export async function closeAllQueues(): Promise<void> {
  const qs = [executionQ, deadLetterQ].filter(Boolean) as Queue[];
  await Promise.all(qs.map((q) => q.close()));
  executionQ = null;
  deadLetterQ = null;
}
