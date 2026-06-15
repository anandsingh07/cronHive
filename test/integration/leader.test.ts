import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { Redis } from "ioredis";

/**
 * Proves the leader-election lease: exactly one instance leads at a time, and a follower
 * takes over automatically when the leader stops (failover).
 */
describe("scheduler leader election (real Redis)", () => {
  let redisC: StartedTestContainer;
  let url: string;

  beforeAll(async () => {
    redisC = await new GenericContainer("redis:7-alpine").withExposedPorts(6379).start();
    url = `redis://${redisC.getHost()}:${redisC.getMappedPort(6379)}`;
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://x:x@localhost:5432/x";
    process.env.REDIS_URL = url;
  }, 120_000);

  afterAll(async () => {
    await redisC?.stop();
  });

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("elects exactly one leader among multiple instances, and fails over", async () => {
    const { startLeaderElection } = await import("../../src/lib/leader.js");

    const r1 = new Redis(url, { maxRetriesPerRequest: null });
    const r2 = new Redis(url, { maxRetriesPerRequest: null });

    const e1 = startLeaderElection(r1, { leaseTtlMs: 1500, heartbeatMs: 300 });
    const e2 = startLeaderElection(r2, { leaseTtlMs: 1500, heartbeatMs: 300 });

    // Give the campaign a moment to resolve.
    await wait(600);

    const leadersNow = [e1.isLeader(), e2.isLeader()].filter(Boolean).length;
    expect(leadersNow).toBe(1); // exactly one leader

    // Identify and stop the current leader; the other should take over within ~lease TTL.
    const leader = e1.isLeader() ? e1 : e2;
    const follower = e1.isLeader() ? e2 : e1;
    expect(follower.isLeader()).toBe(false);

    await leader.stop();

    // After the leader relinquishes, the follower acquires on its next heartbeat.
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && !follower.isLeader()) await wait(100);
    expect(follower.isLeader()).toBe(true);

    await follower.stop();
    r1.disconnect();
    r2.disconnect();
  }, 30_000);
});
