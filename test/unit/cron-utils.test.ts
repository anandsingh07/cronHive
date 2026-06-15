import { describe, it, expect, beforeAll } from "vitest";

// Pin env before importing modules that read it at load time.
beforeAll(() => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://x:x@localhost:5432/x";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
  process.env.SCHEDULER_SCAN_MS = "60000";
});

const load = async () => await import("../../src/lib/cron-utils.js");

describe("dueFireSlot", () => {
  it("returns the exact previous fire timestamp when within the scan window", async () => {
    const { dueFireSlot } = await load();
    // Every minute. "now" is 10s past the top of the minute -> the :00 firing is due.
    const now = new Date("2026-06-16T12:00:10.000Z");
    const slot = dueFireSlot("* * * * *", "UTC", now);
    expect(slot).not.toBeNull();
    expect(slot!.toISOString()).toBe("2026-06-16T12:00:00.000Z");
  });

  it("two evaluations within the same window resolve to the SAME slot (idempotency key)", async () => {
    const { dueFireSlot } = await load();
    // This is the property the double-fire fix depends on: the slot is stable across ticks.
    const a = dueFireSlot("* * * * *", "UTC", new Date("2026-06-16T12:00:03.000Z"));
    const b = dueFireSlot("* * * * *", "UTC", new Date("2026-06-16T12:00:55.000Z"));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.getTime()).toBe(b!.getTime());
  });

  it("returns null when the last firing is older than the window", async () => {
    const { dueFireSlot } = await load();
    // Hourly cron, now is 30 min past the hour -> last firing way outside the 65s window.
    const now = new Date("2026-06-16T12:30:00.000Z");
    expect(dueFireSlot("0 * * * *", "UTC", now)).toBeNull();
  });

  it("respects timezone", async () => {
    const { dueFireSlot } = await load();
    // "0 9 * * *" = 9am local. In Asia/Kolkata (UTC+5:30), 9am IST = 03:30 UTC.
    const now = new Date("2026-06-16T03:30:10.000Z");
    const slot = dueFireSlot("0 9 * * *", "Asia/Kolkata", now);
    expect(slot).not.toBeNull();
    expect(slot!.toISOString()).toBe("2026-06-16T03:30:00.000Z");
  });

  it("returns null for an invalid cron expression instead of throwing", async () => {
    const { dueFireSlot } = await load();
    expect(dueFireSlot("not a cron", "UTC", new Date())).toBeNull();
  });
});

describe("isCronDueNow", () => {
  it("agrees with dueFireSlot", async () => {
    const { isCronDueNow, dueFireSlot } = await load();
    const now = new Date("2026-06-16T12:00:05.000Z");
    expect(isCronDueNow("* * * * *", "UTC", now)).toBe(dueFireSlot("* * * * *", "UTC", now) !== null);
  });
});
