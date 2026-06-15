import type { Redis } from "ioredis";

export const EVENTS_CHANNEL = "cronhive:events";

export type JobStartedPayload = {
  jobId: string;
  executionId: string;
  attemptNumber: number;
  triggerSource?: string;
};

export type JobFinishedPayload = {
  jobId: string;
  executionId: string;
  status: "SUCCESS" | "FAILED" | "DEAD";
  responseCode?: number | null;
  durationMs?: number | null;
  attemptNumber: number;
};

export type JobAlertPayload = {
  jobId: string;
  executionId: string;
  kind: "dead" | "circuit_open";
  message: string;
};

export type CronHiveSocketEvent =
  | { event: "job.started"; payload: JobStartedPayload }
  | { event: "job.success"; payload: JobFinishedPayload }
  | { event: "job.failed"; payload: JobFinishedPayload }
  | { event: "job.alert"; payload: JobAlertPayload };

export async function publishEvent(redis: Redis, msg: CronHiveSocketEvent): Promise<void> {
  await redis.publish(EVENTS_CHANNEL, JSON.stringify(msg));
}
