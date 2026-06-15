import { describe, it, expect, beforeAll } from "vitest";
import type { Job } from "@prisma/client";

beforeAll(() => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://x:x@localhost:5432/x";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
  process.env.LOCK_BUFFER_MS = "10000";
  process.env.DEFAULT_CALLBACK_TIMEOUT_MS = "30000";
});

function makeJob(overrides: Partial<Job>): Job {
  return {
    id: "j1",
    name: "test",
    cronExpression: "* * * * *",
    callbackUrl: "https://example.com/hook",
    timezone: "UTC",
    maxRetries: 3,
    backoffMs: 1000,
    callbackTimeoutMs: 30000,
    enabled: true,
    paused: false,
    consecutiveDeadCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Job;
}

describe("computeJobLockTtlSeconds", () => {
  it("covers the full worst-case retry budget (timeouts + exponential backoff + buffer)", async () => {
    const { computeJobLockTtlSeconds } = await import("../../src/lib/lock-ttl.js");
    const job = makeJob({ maxRetries: 3, backoffMs: 1000, callbackTimeoutMs: 30000 });
    // timeout*(retries+1) = 30000*4 = 120000
    // backoffSum = 1000*(1+2+4) = 7000
    // + buffer 10000 = 137000ms -> 137s
    expect(computeJobLockTtlSeconds(job)).toBe(137);
  });

  it("grows with more retries", async () => {
    const { computeJobLockTtlSeconds } = await import("../../src/lib/lock-ttl.js");
    const few = computeJobLockTtlSeconds(makeJob({ maxRetries: 1 }));
    const many = computeJobLockTtlSeconds(makeJob({ maxRetries: 8 }));
    expect(many).toBeGreaterThan(few);
  });

  it("never returns less than 1 second", async () => {
    const { computeJobLockTtlSeconds } = await import("../../src/lib/lock-ttl.js");
    const job = makeJob({ maxRetries: 0, backoffMs: 100, callbackTimeoutMs: 1000 });
    expect(computeJobLockTtlSeconds(job)).toBeGreaterThanOrEqual(1);
  });
});
