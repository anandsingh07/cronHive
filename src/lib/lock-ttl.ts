import type { Job } from "@prisma/client";
import { loadEnv } from "../config/env.js";

const env = loadEnv();

/** Worst-case wall time for all attempts (timeouts + exponential backoffs) + buffer, in seconds. */
export function computeJobLockTtlSeconds(job: Job): number {
  const timeout = job.callbackTimeoutMs || env.DEFAULT_CALLBACK_TIMEOUT_MS;
  let backoffSum = 0;
  for (let i = 0; i < job.maxRetries; i++) {
    backoffSum += job.backoffMs * Math.pow(2, i);
  }
  const ms = timeout * (job.maxRetries + 1) + backoffSum + env.LOCK_BUFFER_MS;
  return Math.max(1, Math.ceil(ms / 1000));
}
