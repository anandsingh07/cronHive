import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

/**
 * The headline correctness test for CronHive.
 *
 * Proves that the double-fire fix holds under genuine concurrency: many scheduler
 * ticks / replicas racing to claim the SAME cron fire-slot produce EXACTLY ONE
 * execution, because the unique constraint @@unique([jobId, scheduledFor]) makes a
 * duplicate physically impossible. The Redis lock is only a fast-path; this test
 * deliberately exercises the DB guarantee directly.
 */
describe("double-fire prevention (real Postgres)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    const url = container.getConnectionUri();
    process.env.DATABASE_URL = url;

    // Apply the schema (migrations) to the fresh container.
    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "inherit",
    });

    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  async function freshJob() {
    return prisma.job.create({
      data: {
        name: "concurrency-test",
        cronExpression: "* * * * *",
        callbackUrl: "https://example.com/hook",
      },
    });
  }

  it("50 concurrent claims for one fire-slot create exactly one execution", async () => {
    const job = await freshJob();
    const slot = new Date("2026-06-16T12:00:00.000Z");

    // Mirror exactly what the scheduler does: create with (jobId, scheduledFor),
    // swallowing the P2002 unique violation as "already claimed".
    const claim = async () => {
      try {
        await prisma.execution.create({
          data: { jobId: job.id, scheduledFor: slot, status: "PENDING", triggerSource: "schedule" },
        });
        return "created";
      } catch (e: any) {
        if (e?.code === "P2002") return "skipped";
        throw e;
      }
    };

    const results = await Promise.all(Array.from({ length: 50 }, () => claim()));

    const created = results.filter((r) => r === "created").length;
    const skipped = results.filter((r) => r === "skipped").length;

    expect(created).toBe(1);
    expect(skipped).toBe(49);

    const rows = await prisma.execution.count({
      where: { jobId: job.id, scheduledFor: slot },
    });
    expect(rows).toBe(1);
  });

  it("different fire-slots for the same job each create their own execution", async () => {
    const job = await freshJob();
    const slots = [
      new Date("2026-06-16T13:00:00.000Z"),
      new Date("2026-06-16T13:01:00.000Z"),
      new Date("2026-06-16T13:02:00.000Z"),
    ];
    await Promise.all(
      slots.map((s) =>
        prisma.execution.create({
          data: { jobId: job.id, scheduledFor: s, status: "PENDING", triggerSource: "schedule" },
        })
      )
    );
    const rows = await prisma.execution.count({ where: { jobId: job.id } });
    expect(rows).toBe(3);
  });

  it("manual triggers (scheduledFor = null) are NOT deduplicated", async () => {
    const job = await freshJob();
    // Multiple manual runs must all be allowed — NULLs are distinct under the unique index.
    await Promise.all(
      Array.from({ length: 5 }, () =>
        prisma.execution.create({
          data: { jobId: job.id, status: "PENDING", triggerSource: "manual" },
        })
      )
    );
    const rows = await prisma.execution.count({
      where: { jobId: job.id, scheduledFor: null },
    });
    expect(rows).toBe(5);
  });
});
