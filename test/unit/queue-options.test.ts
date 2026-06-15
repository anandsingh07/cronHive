import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://x:x@localhost:5432/x";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

describe("executionJobOptions (BullMQ-native retry policy)", () => {
  it("maps maxRetries to attempts = maxRetries + 1 (initial try + N retries)", async () => {
    const { executionJobOptions } = await import("../../src/lib/queues.js");
    expect(executionJobOptions({ maxRetries: 3, backoffMs: 1000 }).attempts).toBe(4);
    expect(executionJobOptions({ maxRetries: 0, backoffMs: 1000 }).attempts).toBe(1);
  });

  it("uses exponential backoff seeded from the job's backoffMs", async () => {
    const { executionJobOptions } = await import("../../src/lib/queues.js");
    const opts = executionJobOptions({ maxRetries: 5, backoffMs: 2000 });
    expect(opts.backoff).toEqual({ type: "exponential", delay: 2000 });
  });
});
