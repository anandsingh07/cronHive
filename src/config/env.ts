import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().positive().default(3000),
  /** Extra milliseconds added to Redis lock TTL beyond worst-case callback + retries */
  LOCK_BUFFER_MS: z.coerce.number().int().nonnegative().default(10_000),
  CIRCUIT_BREAKER_CONSECUTIVE_DEAD: z.coerce.number().int().positive().default(10),
  /** Default HTTP callback timeout when job omits callbackTimeoutMs */
  DEFAULT_CALLBACK_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  SCHEDULER_SCAN_MS: z.coerce.number().int().positive().default(60_000),
  CRONHIVE_SIGNING_SECRET: z.string().min(1).default("replace_this_with_a_secure_secret"),
  /** Number of executions a single worker process handles concurrently */
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  /** Port for the scheduler's standalone /metrics + /health endpoint */
  SCHEDULER_METRICS_PORT: z.coerce.number().int().positive().default(9101),
  /** Port for the worker's standalone /metrics + /health endpoint */
  WORKER_METRICS_PORT: z.coerce.number().int().positive().default(9102),
  /** Leader-election lease TTL; a dead leader fails over within ~this window */
  LEADER_LEASE_MS: z.coerce.number().int().positive().default(10_000),
  /**
   * If false, every scheduler instance scans (legacy behaviour, still correct thanks to
   * the DB unique constraint). If true (default), only the elected leader scans.
   */
  SCHEDULER_LEADER_ELECTION: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /** Comma-separated API keys for the management API. Empty = auth disabled (dev only). */
  CRONHIVE_API_KEYS: z.string().default(""),
  /** Allow callback URLs that resolve to private/loopback addresses (dev only). */
  CRONHIVE_ALLOW_PRIVATE_CALLBACKS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Rate limit: max requests per window per IP */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  /** Rate limit window in milliseconds */
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment: ${JSON.stringify(msg)}`);
  }
  cached = parsed.data;
  return parsed.data;
}

export function resetEnvCache(): void {
  cached = null;
}
