import { CronExpressionParser } from "cron-parser";
import { loadEnv } from "../config/env.js";

const env = loadEnv();

/**
 * Returns true if the cron expression had a firing in the last scheduler window (prevents drift misses).
 */
export function isCronDueNow(
  cronExpression: string,
  timezone: string,
  now: Date = new Date()
): boolean {
  return dueFireSlot(cronExpression, timezone, now) !== null;
}

/**
 * Returns the exact cron fire-time slot that is "due" within the current scheduler window,
 * or null if the job is not due now. This timestamp is the idempotency key for an execution:
 * two scheduler ticks (or two scheduler nodes) evaluating the same window resolve to the SAME
 * slot, so a unique constraint on (jobId, scheduledFor) collapses them into one execution.
 */
export function dueFireSlot(
  cronExpression: string,
  timezone: string,
  now: Date = new Date()
): Date | null {
  try {
    const interval = CronExpressionParser.parse(cronExpression, {
      currentDate: now,
      tz: timezone || "UTC",
    });
    const prev = interval.prev().toDate();
    const diff = now.getTime() - prev.getTime();
    const windowMs = env.SCHEDULER_SCAN_MS + 5000;
    if (diff >= 0 && diff <= windowMs) return prev;
    return null;
  } catch {
    return null;
  }
}

export function assertValidCron(cronExpression: string, timezone: string): void {
  CronExpressionParser.parse(cronExpression, { tz: timezone || "UTC" });
}
