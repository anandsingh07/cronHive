import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { Redis } from "ioredis";

/**
 * Proves the owner-token lock is safe against the classic Redis lock bug: a holder must
 * NOT be able to release a lock that has since been re-acquired by someone else.
 */
describe("owner-token distributed lock (real Redis)", () => {
  let redisC: StartedTestContainer;
  let redis: Redis;

  beforeAll(async () => {
    redisC = await new GenericContainer("redis:7-alpine").withExposedPorts(6379).start();
    redis = new Redis(`redis://${redisC.getHost()}:${redisC.getMappedPort(6379)}`, {
      maxRetriesPerRequest: null,
    });
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://x:x@localhost:5432/x";
    process.env.REDIS_URL = `redis://${redisC.getHost()}:${redisC.getMappedPort(6379)}`;
  }, 120_000);

  afterAll(async () => {
    redis?.disconnect();
    await redisC?.stop();
  });

  it("acquire returns a token handle; second acquire on the same slot fails", async () => {
    const { acquireJobLock } = await import("../../src/lib/lock.js");
    const a = await acquireJobLock(redis, "jobA", 1000, 30);
    const b = await acquireJobLock(redis, "jobA", 1000, 30);
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    expect(a!.token).toMatch(/[0-9a-f-]{36}/);
  });

  it("releasing with the correct token frees the lock", async () => {
    const { acquireJobLock, releaseJobLock } = await import("../../src/lib/lock.js");
    const a = await acquireJobLock(redis, "jobB", 1000, 30);
    expect(a).not.toBeNull();
    await releaseJobLock(redis, a!);
    const c = await acquireJobLock(redis, "jobB", 1000, 30);
    expect(c).not.toBeNull(); // re-acquirable after release
  });

  it("does NOT delete a lock re-acquired by another owner (the safety property)", async () => {
    const { acquireJobLock, releaseJobLock, jobLockKey } = await import("../../src/lib/lock.js");
    // Owner 1 acquires.
    const owner1 = await acquireJobLock(redis, "jobC", 2000, 30);
    expect(owner1).not.toBeNull();

    // Simulate TTL expiry by manually deleting, then owner 2 acquires the same slot.
    await redis.del(jobLockKey("jobC", 2000));
    const owner2 = await acquireJobLock(redis, "jobC", 2000, 30);
    expect(owner2).not.toBeNull();

    // Owner 1's stale release must NOT remove owner 2's lock.
    await releaseJobLock(redis, owner1!);
    const stillHeld = await redis.get(jobLockKey("jobC", 2000));
    expect(stillHeld).toBe(owner2!.token); // owner 2 still holds it
  });
});
