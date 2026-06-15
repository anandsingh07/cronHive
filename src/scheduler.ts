import { loadEnv } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import { acquireJobLock, releaseJobLock } from "./lib/lock.js";
import { computeJobLockTtlSeconds } from "./lib/lock-ttl.js";
import { dueFireSlot } from "./lib/cron-utils.js";
import { getExecutionQueue, executionJobOptions } from "./lib/queues.js";
import { createScheduledExecution } from "./services/execution.service.js";
import { logger } from "./lib/logger.js";
import { startMetricsServer } from "./lib/metrics-server.js";
import { startLeaderElection, type LeaderElection } from "./lib/leader.js";
import {
  schedulerTicksTotal,
  slotsEnqueuedTotal,
  slotsDedupedTotal,
  schedulerTickDuration,
} from "./lib/metrics.js";

const env = loadEnv();
const log = logger.child({ component: "scheduler" });

let lastConnectionErrorLog = 0;
const CONNECTION_ERROR_LOG_MS = 60_000;

function isDbUnreachableError(err: unknown): boolean {
  const s = String(err);
  return s.includes("P1001") || s.includes("Can't reach database");
}

async function tick(): Promise<void> {
  const endTimer = schedulerTickDuration.startTimer();
  schedulerTicksTotal.inc();

  const jobs = await prisma.job.findMany({
    where: { enabled: true, paused: false },
  });

  const queue = getExecutionQueue();

  for (const job of jobs) {
    const slot = dueFireSlot(job.cronExpression, job.timezone);
    if (!slot) continue;

    // Fast-path: a Redis lock keyed on the exact (job, fire-slot) avoids redundant DB work
    // when many ticks/nodes see the same slot. It is NOT the correctness guarantee — the
    // unique constraint on (jobId, scheduledFor) is. So a failed lock acquire is just a skip.
    const ttl = computeJobLockTtlSeconds(job);
    const lock = await acquireJobLock(redis, job.id, slot.getTime(), ttl);
    if (!lock) {
      slotsDedupedTotal.inc();
      continue;
    }

    try {
      // Correctness guarantee: returns null if this slot was already claimed (P2002),
      // so a lost race after the lock fast-path still cannot double-fire.
      const ex = await createScheduledExecution(job.id, slot);
      if (!ex) {
        slotsDedupedTotal.inc();
        await releaseJobLock(redis, lock);
        continue;
      }
      await queue.add(
        "execution",
        { executionId: ex.id, jobId: job.id, fireSlot: slot.getTime() },
        executionJobOptions(job)
      );
      slotsEnqueuedTotal.inc();
      log.debug({ jobId: job.id, slot: slot.toISOString() }, "enqueued fire-slot");
    } catch (e) {
      await releaseJobLock(redis, lock);
      throw e;
    }
  }

  endTimer();
}

async function main(): Promise<void> {
  loadEnv();
  log.info(
    { scanMs: env.SCHEDULER_SCAN_MS, leaderElection: env.SCHEDULER_LEADER_ELECTION },
    "scheduler started"
  );
  const metricsServer = startMetricsServer(env.SCHEDULER_METRICS_PORT, "scheduler");

  let election: LeaderElection | null = null;
  if (env.SCHEDULER_LEADER_ELECTION) {
    election = startLeaderElection(redis, { leaseTtlMs: env.LEADER_LEASE_MS });
  }

  const run = () => {
    // When leader election is on, only the elected leader scans. Followers stay idle but
    // ready to take over on failover. (Correctness doesn't depend on this — the DB unique
    // constraint already prevents double-fires — but it avoids redundant full-table scans.)
    if (election && !election.isLeader()) return;
    void tick().catch((err) => {
      if (isDbUnreachableError(err)) {
        const now = Date.now();
        if (now - lastConnectionErrorLog < CONNECTION_ERROR_LOG_MS) return;
        lastConnectionErrorLog = now;
        log.error({ err }, "database unreachable (check DATABASE_URL / Postgres)");
        return;
      }
      log.error({ err }, "tick error");
    });
  };
  run();
  const id = setInterval(run, env.SCHEDULER_SCAN_MS);

  const shutdown = async (signal: string) => {
    log.info({ signal }, "stopping scheduler");
    clearInterval(id);
    if (election) await election.stop();
    metricsServer.close();
    await getExecutionQueue().close();
    await redis.quit();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void main();
