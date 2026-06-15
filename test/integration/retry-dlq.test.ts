import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { execSync } from "node:child_process";
import http from "node:http";
import { PrismaClient } from "@prisma/client";
import { Queue, Worker } from "bullmq";

/**
 * Proves the BullMQ-native retry → dead-letter flow end to end with a real Redis and
 * Postgres: a callback that always fails is retried `attempts` times with backoff, every
 * attempt is recorded, and the execution ends DEAD (dead-lettered) — with NO duplicate
 * executions from a second retry mechanism (the old dual-retry bug).
 */
describe("retry + dead-letter (real Redis + Postgres)", () => {
  let pg: StartedPostgreSqlContainer;
  let redisC: StartedTestContainer;
  let prisma: PrismaClient;
  let failingServer: http.Server;
  let callbackUrl: string;
  let callCount = 0;

  beforeAll(async () => {
    pg = await new PostgreSqlContainer("postgres:16-alpine").start();
    redisC = await new GenericContainer("redis:7-alpine").withExposedPorts(6379).start();

    const dbUrl = pg.getConnectionUri();
    const redisUrl = `redis://${redisC.getHost()}:${redisC.getMappedPort(6379)}`;
    process.env.DATABASE_URL = dbUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.CRONHIVE_SIGNING_SECRET = "test-secret";

    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: "inherit",
    });

    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    await prisma.$connect();

    // A callback that always returns 500.
    failingServer = http.createServer((_req, res) => {
      callCount++;
      res.writeHead(500).end("nope");
    });
    await new Promise<void>((r) => failingServer.listen(0, r));
    const port = (failingServer.address() as { port: number }).port;
    callbackUrl = `http://127.0.0.1:${port}/fail`;
  }, 180_000);

  afterAll(async () => {
    failingServer?.close();
    await prisma?.$disconnect();
    await redisC?.stop();
    await pg?.stop();
  });

  it("retries up to attempts, records each, ends DEAD, and dead-letters exactly once", async () => {
    // Import after env is set so the modules pick up the container URLs.
    const { processExecutionJob } = await import("../../src/worker.js");
    const { QUEUE_EXECUTION, QUEUE_PREFIX, buildConnection, executionJobOptions } =
      await import("../../src/lib/queues.js");

    const job = await prisma.job.create({
      data: {
        name: "always-fails",
        cronExpression: "* * * * *",
        callbackUrl,
        maxRetries: 2, // -> attempts = 3
        backoffMs: 50, // keep the test fast
      },
    });
    const ex = await prisma.execution.create({
      data: { jobId: job.id, scheduledFor: new Date("2026-06-16T15:00:00Z"), triggerSource: "schedule" },
    });

    const connection = buildConnection();
    const queue = new Queue(QUEUE_EXECUTION, { connection, prefix: QUEUE_PREFIX });
    const worker = new Worker(QUEUE_EXECUTION, (j) => processExecutionJob(j as any), {
      connection,
      prefix: QUEUE_PREFIX,
      concurrency: 1,
    });

    await queue.add("execution", { executionId: ex.id, jobId: job.id, fireSlot: 15e11 }, executionJobOptions(job));

    // Wait until the execution reaches a terminal DEAD state (or time out).
    const deadline = Date.now() + 20_000;
    let status = "";
    while (Date.now() < deadline) {
      const row = await prisma.execution.findUnique({ where: { id: ex.id } });
      status = row?.status ?? "";
      if (status === "DEAD") break;
      await new Promise((r) => setTimeout(r, 200));
    }

    await worker.close();
    await queue.close();

    // The callback was attempted exactly `attempts` (3) times — no extra retry mechanism.
    expect(callCount).toBe(3);
    expect(status).toBe("DEAD");

    // Exactly one execution row exists for this slot (no duplicate executions).
    const rows = await prisma.execution.count({ where: { jobId: job.id } });
    expect(rows).toBe(1);

    // The final attempt number recorded is 3.
    const finalRow = await prisma.execution.findUnique({ where: { id: ex.id } });
    expect(finalRow?.attemptNumber).toBe(3);

    // Circuit-breaker dead streak incremented.
    const jobAfter = await prisma.job.findUnique({ where: { id: job.id } });
    expect(jobAfter?.consecutiveDeadCount).toBe(1);
  }, 60_000);
});
