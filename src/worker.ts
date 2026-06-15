import { ExecutionStatus } from "@prisma/client";
import { Worker, type Job as BullJob } from "bullmq";
import { loadEnv } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import {
  buildConnection,
  getDeadLetterQueue,
  QUEUE_EXECUTION,
  QUEUE_PREFIX,
  type ExecutionJobData,
} from "./lib/queues.js";
import { publishEvent } from "./lib/events.js";
import { invokeCallback } from "./services/callback.service.js";
import { getCachedJob } from "./lib/job-cache.js";
import { logger } from "./lib/logger.js";
import { startMetricsServer } from "./lib/metrics-server.js";
import {
  executionsTotal,
  executionDuration,
  callbackAttemptsTotal,
  circuitOpenTotal,
} from "./lib/metrics.js";

const log = logger.child({ component: "worker" });

const env = loadEnv();

async function applyCircuitBreaker(jobId: string, executionId: string): Promise<void> {
  const job = await prisma.job.update({
    where: { id: jobId },
    data: { consecutiveDeadCount: { increment: 1 } },
  });
  if (job.consecutiveDeadCount >= env.CIRCUIT_BREAKER_CONSECUTIVE_DEAD) {
    await prisma.job.update({
      where: { id: jobId },
      data: { enabled: false },
    });
    circuitOpenTotal.inc();
    log.warn({ jobId, executionId }, "circuit breaker opened; job disabled");
    await publishEvent(redis, {
      event: "job.alert",
      payload: {
        jobId,
        executionId,
        kind: "circuit_open",
        message: `Job disabled after ${env.CIRCUIT_BREAKER_CONSECUTIVE_DEAD} consecutive DEAD executions`,
      },
    });
  }
}

async function resetDeadStreak(jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { consecutiveDeadCount: 0 },
  });
}

async function deadLetter(
  executionId: string,
  jobId: string,
  attemptNumber: number,
  errMsg: string,
  statusCode: number | null,
  durationMs: number
): Promise<void> {
  await prisma.execution.update({
    where: { id: executionId },
    data: {
      status: ExecutionStatus.DEAD,
      finishedAt: new Date(),
      responseCode: statusCode,
      durationMs,
      errorMessage: errMsg,
    },
  });
  await getDeadLetterQueue().add("dead", {
    executionId,
    jobId,
    reason: "max_retries_exceeded",
    lastError: errMsg,
  });
  executionsTotal.inc({ status: "DEAD" });
  executionDuration.observe({ status: "DEAD" }, durationMs / 1000);
  log.error({ jobId, executionId, attemptNumber, errMsg }, "execution dead-lettered");
  await applyCircuitBreaker(jobId, executionId);
  await publishEvent(redis, {
    event: "job.failed",
    payload: {
      jobId,
      executionId,
      status: "DEAD",
      responseCode: statusCode,
      durationMs,
      attemptNumber,
    },
  });
  await publishEvent(redis, {
    event: "job.alert",
    payload: {
      jobId,
      executionId,
      kind: "dead",
      message: `Execution DEAD after ${attemptNumber} attempts: ${errMsg}`,
    },
  });
}

/**
 * Process one execution attempt.
 *
 * Retry semantics are now BullMQ-native: when the callback fails and retries remain,
 * this function THROWS so BullMQ re-queues the job with its configured exponential
 * backoff. There is no longer a separate app-level retry queue — that was the source
 * of duplicate executions (Bull's implicit retry racing the manual retry queue).
 *
 * BullMQ tracks attempts: `job.attemptsMade` is 0 on the first run, so the human-facing
 * attempt number is `attemptsMade + 1`. When `attemptsMade + 1 >= job.opts.attempts`
 * this is the final attempt, and on failure we dead-letter instead of throwing.
 */
export async function processExecutionJob(bullJob: BullJob<ExecutionJobData>): Promise<void> {
  const { executionId, jobId } = bullJob.data;
  const attemptNumber = bullJob.attemptsMade + 1;
  const maxAttempts = bullJob.opts.attempts ?? 1;
  const isFinalAttempt = attemptNumber >= maxAttempts;

  const job =
    (await getCachedJob(redis, jobId)) ?? (await prisma.job.findUnique({ where: { id: jobId } }));
  if (!job || !job.enabled) {
    return;
  }

  const execution = await prisma.execution.findUnique({ where: { id: executionId } });
  if (!execution) {
    return;
  }

  const now = new Date();
  await prisma.execution.update({
    where: { id: executionId },
    data: {
      status: ExecutionStatus.RUNNING,
      startedAt: execution.startedAt ?? now,
      attemptNumber,
      finishedAt: null,
    },
  });

  await publishEvent(redis, {
    event: "job.started",
    payload: {
      jobId,
      executionId,
      attemptNumber,
      triggerSource: execution.triggerSource,
    },
  });

  const result = await invokeCallback(
    job.callbackUrl,
    {
      jobId: job.id,
      jobName: job.name,
      executionId,
      attemptNumber,
      triggeredAt: execution.triggeredAt.toISOString(),
    },
    job.callbackTimeoutMs
  );

  if (result.ok) {
    await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.SUCCESS,
        finishedAt: new Date(),
        responseCode: result.statusCode,
        durationMs: result.durationMs,
        errorMessage: null,
      },
    });
    await resetDeadStreak(jobId);
    executionsTotal.inc({ status: "SUCCESS" });
    executionDuration.observe({ status: "SUCCESS" }, result.durationMs / 1000);
    callbackAttemptsTotal.inc({ outcome: "ok" });
    log.info({ jobId, executionId, attemptNumber, durationMs: result.durationMs }, "execution success");
    await publishEvent(redis, {
      event: "job.success",
      payload: {
        jobId,
        executionId,
        status: "SUCCESS",
        responseCode: result.statusCode,
        durationMs: result.durationMs,
        attemptNumber,
      },
    });
    return;
  }

  const errMsg = `${result.kind}: ${result.message}`;
  callbackAttemptsTotal.inc({ outcome: result.kind });

  if (isFinalAttempt) {
    // Retries exhausted -> dead-letter + circuit breaker. Do NOT throw (BullMQ would
    // mark it failed but there are no attempts left anyway; we own the terminal state).
    await deadLetter(executionId, jobId, attemptNumber, errMsg, result.statusCode ?? null, result.durationMs);
    return;
  }

  // Retries remain: record the failed attempt, emit the event, then THROW so BullMQ
  // schedules the next attempt with native exponential backoff.
  await prisma.execution.update({
    where: { id: executionId },
    data: {
      status: ExecutionStatus.FAILED,
      finishedAt: new Date(),
      responseCode: result.statusCode ?? null,
      durationMs: result.durationMs,
      errorMessage: errMsg,
    },
  });
  await publishEvent(redis, {
    event: "job.failed",
    payload: {
      jobId,
      executionId,
      status: "FAILED",
      responseCode: result.statusCode ?? null,
      durationMs: result.durationMs,
      attemptNumber,
    },
  });
  log.warn({ jobId, executionId, attemptNumber, errMsg }, "attempt failed; will retry");
  throw new Error(errMsg);
}

let worker: Worker<ExecutionJobData> | null = null;

function startWorker(): Worker<ExecutionJobData> {
  const concurrency = env.WORKER_CONCURRENCY;
  worker = new Worker<ExecutionJobData>(QUEUE_EXECUTION, (job) => processExecutionJob(job), {
    connection: buildConnection(),
    prefix: QUEUE_PREFIX,
    concurrency,
  });
  worker.on("error", (err) => log.error({ err }, "worker error"));
  return worker;
}

async function main(): Promise<void> {
  loadEnv();
  startWorker();
  const metricsServer = startMetricsServer(env.WORKER_METRICS_PORT, "worker");
  log.info({ concurrency: env.WORKER_CONCURRENCY }, "BullMQ worker started");

  const shutdown = async (signal: string) => {
    log.info({ signal }, "draining in-flight jobs");
    metricsServer.close();
    // worker.close() waits for active jobs to finish before resolving.
    if (worker) await worker.close();
    await getDeadLetterQueue().close();
    await redis.quit();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// Only auto-start when run as the entrypoint (e.g. `node dist/worker.js`), not when
// imported by tests that exercise processExecutionJob directly.
const isEntrypoint = process.argv[1]?.includes("worker");
if (isEntrypoint) void main();
