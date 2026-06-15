import type { Job } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { cacheJobConfig, invalidateJobConfig } from "../lib/job-cache.js";
import { assertValidCron } from "../lib/cron-utils.js";
import { assertSafeCallbackUrl } from "../lib/ssrf.js";
import { loadEnv } from "../config/env.js";

const env = loadEnv();

/** Thrown when a callback URL fails the SSRF safety check; mapped to HTTP 400. */
export class UnsafeCallbackUrlError extends Error {
  constructor(reason: string) {
    super(`Unsafe callback URL: ${reason}`);
    this.name = "UnsafeCallbackUrlError";
  }
}

async function ensureSafeCallback(url: string): Promise<void> {
  const result = await assertSafeCallbackUrl(url, {
    allowPrivate: env.CRONHIVE_ALLOW_PRIVATE_CALLBACKS,
  });
  if (!result.ok) throw new UnsafeCallbackUrlError(result.reason ?? "rejected");
}

export type CreateJobInput = {
  name: string;
  cronExpression: string;
  callbackUrl: string;
  retryPolicy: { maxRetries: number; backoffMs: number };
  timezone?: string;
  enabled?: boolean;
  paused?: boolean;
  callbackTimeoutMs?: number;
};

export type UpdateJobInput = Partial<
  Pick<
    Job,
    | "name"
    | "cronExpression"
    | "callbackUrl"
    | "timezone"
    | "maxRetries"
    | "backoffMs"
    | "callbackTimeoutMs"
    | "enabled"
    | "paused"
  >
>;

export async function createJob(input: CreateJobInput): Promise<Job> {
  assertValidCron(input.cronExpression, input.timezone ?? "UTC");
  await ensureSafeCallback(input.callbackUrl);
  const job = await prisma.job.create({
    data: {
      name: input.name,
      cronExpression: input.cronExpression,
      callbackUrl: input.callbackUrl,
      timezone: input.timezone ?? "UTC",
      maxRetries: input.retryPolicy.maxRetries,
      backoffMs: input.retryPolicy.backoffMs,
      callbackTimeoutMs: input.callbackTimeoutMs ?? env.DEFAULT_CALLBACK_TIMEOUT_MS,
      enabled: input.enabled ?? true,
      paused: input.paused ?? false,
    },
  });
  await cacheJobConfig(redis, job);
  return job;
}

export async function getJobById(id: string): Promise<Job | null> {
  return prisma.job.findUnique({ where: { id } });
}

export async function listJobs(): Promise<Job[]> {
  return prisma.job.findMany({ orderBy: { createdAt: "desc" } });
}

export async function updateJob(id: string, data: UpdateJobInput): Promise<Job | null> {
  if (data.cronExpression !== undefined || data.timezone !== undefined) {
    const existing = await prisma.job.findUnique({ where: { id } });
    if (!existing) return null;
    assertValidCron(
      data.cronExpression ?? existing.cronExpression,
      data.timezone ?? existing.timezone
    );
  }
  if (data.callbackUrl !== undefined) {
    await ensureSafeCallback(data.callbackUrl);
  }
  try {
    const job = await prisma.job.update({ where: { id }, data });
    await invalidateJobConfig(redis, id);
    await cacheJobConfig(redis, job);
    return job;
  } catch {
    return null;
  }
}

export async function deleteJob(id: string): Promise<boolean> {
  try {
    await prisma.job.delete({ where: { id } });
    await invalidateJobConfig(redis, id);
    return true;
  } catch {
    return false;
  }
}

export async function setPaused(id: string, paused: boolean): Promise<Job | null> {
  return updateJob(id, { paused });
}

export async function bulkSetEnabled(ids: string[], enabled: boolean): Promise<number> {
  const res = await prisma.job.updateMany({ where: { id: { in: ids } }, data: { enabled } });
  await Promise.all(ids.map((id) => invalidateJobConfig(redis, id)));
  return res.count;
}
