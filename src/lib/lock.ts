import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

/**
 * Owner-token distributed lock (single-Redis variant of the Redlock pattern).
 *
 * Why a token: a blind `DEL` on release is unsafe. If a lock's TTL expires while the
 * holder is still working, another node can acquire the SAME key — and the original
 * holder's later release would then delete the *new* owner's lock. We avoid this by
 * writing a unique token on acquire and releasing with an atomic compare-and-delete
 * (Lua), so a holder can only ever delete its OWN lock.
 *
 * The lock is keyed on (jobId, fireSlot) so it gates one specific cron fire-time. A
 * fireSlot of "manual" is used for ad-hoc API triggers, intentionally not deduplicated
 * against scheduled fires.
 *
 * Note: this lock is a best-effort fast-path to avoid redundant work. The actual
 * correctness guarantee against double-firing is the DB unique constraint on
 * (jobId, scheduledFor) — see services/execution.service.ts.
 */

export function jobLockKey(jobId: string, fireSlot: number | "manual"): string {
  return `lock:job:${jobId}:${fireSlot}`;
}

// Atomic compare-and-delete: only release if the stored token matches ours.
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export interface JobLock {
  jobId: string;
  fireSlot: number | "manual";
  token: string;
}

/**
 * Try to acquire the lock. Returns a JobLock handle (carrying the owner token) on
 * success, or null if the lock is already held.
 */
export async function acquireJobLock(
  redis: Redis,
  jobId: string,
  fireSlot: number | "manual",
  ttlSeconds: number
): Promise<JobLock | null> {
  if (ttlSeconds < 1) ttlSeconds = 1;
  const token = randomUUID();
  const res = await redis.set(jobLockKey(jobId, fireSlot), token, "EX", ttlSeconds, "NX");
  return res === "OK" ? { jobId, fireSlot, token } : null;
}

/**
 * Release a lock we own. Safe under TTL expiry: the Lua compare-and-delete guarantees
 * we only delete the key if it still carries our token.
 */
export async function releaseJobLock(redis: Redis, lock: JobLock): Promise<void> {
  await redis.eval(RELEASE_SCRIPT, 1, jobLockKey(lock.jobId, lock.fireSlot), lock.token);
}
