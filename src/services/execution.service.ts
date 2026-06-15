import { ExecutionStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export async function createExecution(
  jobId: string,
  triggerSource: "schedule" | "manual" = "schedule"
) {
  return prisma.execution.create({
    data: {
      jobId,
      status: ExecutionStatus.PENDING,
      attemptNumber: 1,
      triggerSource,
    },
  });
}

/**
 * Idempotently create the execution for a specific cron fire-slot.
 *
 * Concurrency safety: relies on the DB unique constraint @@unique([jobId, scheduledFor]).
 * If a concurrent scheduler tick (or another scheduler replica) already inserted the row
 * for this slot, Postgres rejects the second insert with P2002 and we return null instead
 * of throwing — so the caller simply skips enqueueing a duplicate. This is the actual
 * double-fire guarantee; the Redis lock is only a best-effort fast-path to avoid the work.
 *
 * Returns the created execution, or null if this slot was already claimed.
 */
export async function createScheduledExecution(jobId: string, scheduledFor: Date) {
  try {
    return await prisma.execution.create({
      data: {
        jobId,
        scheduledFor,
        status: ExecutionStatus.PENDING,
        attemptNumber: 1,
        triggerSource: "schedule",
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // Unique violation on (jobId, scheduledFor) — slot already claimed. Not an error.
      return null;
    }
    throw e;
  }
}

export async function listExecutions(
  jobId: string,
  page: number,
  limit: number
): Promise<{ items: Awaited<ReturnType<typeof prisma.execution.findMany>>; total: number }> {
  const skip = (page - 1) * limit;
  const where: Prisma.ExecutionWhereInput = { jobId };
  const [items, total] = await Promise.all([
    prisma.execution.findMany({
      where,
      orderBy: { triggeredAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.execution.count({ where }),
  ]);
  return { items, total };
}

export type JobStats = {
  windowDays: number;
  totalRuns: number;
  successCount: number;
  failedCount: number;
  deadCount: number;
  successRate: number;
  avgDurationMs: number | null;
};

export async function getJobStats(jobId: string, days = 7): Promise<JobStats | null> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return null;

  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = await prisma.execution.findMany({
    where: {
      jobId,
      triggeredAt: { gte: since },
      status: { in: [ExecutionStatus.SUCCESS, ExecutionStatus.FAILED, ExecutionStatus.DEAD] },
      finishedAt: { not: null },
    },
    select: { status: true, durationMs: true },
  });

  const successCount = rows.filter((r) => r.status === ExecutionStatus.SUCCESS).length;
  const failedCount = rows.filter((r) => r.status === ExecutionStatus.FAILED).length;
  const deadCount = rows.filter((r) => r.status === ExecutionStatus.DEAD).length;
  const totalRuns = rows.length;
  const durations = rows
    .filter((r) => r.durationMs != null)
    .map((r) => r.durationMs as number);
  const avgDurationMs =
    durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  const successRate = totalRuns === 0 ? 0 : successCount / totalRuns;

  return {
    windowDays: days,
    totalRuns,
    successCount,
    failedCount,
    deadCount,
    successRate,
    avgDurationMs,
  };
}
