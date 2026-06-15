import type { Redis } from "ioredis";
import type { Job } from "@prisma/client";

const PREFIX = "job:config:";

export function jobConfigKey(jobId: string): string {
  return `${PREFIX}${jobId}`;
}

export async function cacheJobConfig(redis: Redis, job: Job): Promise<void> {
  await redis.set(jobConfigKey(job.id), JSON.stringify(job), "EX", 3600);
}

export async function invalidateJobConfig(redis: Redis, jobId: string): Promise<void> {
  await redis.del(jobConfigKey(jobId));
}

export async function getCachedJob(
  redis: Redis,
  jobId: string
): Promise<Job | null> {
  const raw = await redis.get(jobConfigKey(jobId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Job;
  } catch {
    return null;
  }
}
