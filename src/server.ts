import express, { type ErrorRequestHandler } from "express";
import "express-async-errors";
import http from "node:http";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { rateLimit } from "express-rate-limit";
import { Server as SocketIOServer } from "socket.io";
import { ZodError } from "zod";
import { loadEnv } from "./config/env.js";
import jobsRouter from "./routes/jobs.router.js";
import { redis } from "./lib/redis.js";
import { prisma, disconnectPrisma } from "./lib/prisma.js";
import { EVENTS_CHANNEL, type CronHiveSocketEvent } from "./lib/events.js";
import { logger } from "./lib/logger.js";
import { registry } from "./lib/metrics.js";
import { requireApiKey, authEnabled } from "./lib/auth.js";
import { UnsafeCallbackUrlError } from "./services/job.service.js";

const env = loadEnv();
const log = logger.child({ component: "api" });

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));
app.use(pinoHttp({ logger }));

// Liveness: process is up. Cheap, no dependencies — used by container orchestrators.
app.get("/health/live", (_req, res) => {
  res.json({ status: "ok", service: "cronhive-api" });
});

// Readiness: dependencies (Postgres + Redis) are reachable. Returns 503 if not, so a
// load balancer / k8s readiness probe stops routing traffic to a broken instance.
app.get("/health", async (_req, res) => {
  const checks: Record<string, "ok" | "fail"> = { db: "fail", redis: "fail" };
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = "ok";
  } catch {
    /* leave as fail */
  }
  try {
    const pong = await redis.ping();
    checks.redis = pong === "PONG" ? "ok" : "fail";
  } catch {
    /* leave as fail */
  }
  const healthy = checks.db === "ok" && checks.redis === "ok";
  res.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "degraded", checks });
});

// Prometheus scrape endpoint for the API process. Unauthenticated (scraped internally).
app.get("/metrics", async (_req, res) => {
  res.set("content-type", registry.contentType);
  res.end(await registry.metrics());
});

// Rate limit + API-key auth apply to the management API (not health/metrics probes above).
const limiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/jobs", limiter, requireApiKey, jobsRouter);

// App Router / API setup
app.get("/", (_req, res) => {
  res.send("CronHive API is running. Access the dashboard via the Next.js frontend.");
});

const zodError: ErrorRequestHandler = (err, _req, res, next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Validation failed", details: err.flatten() });
    return;
  }
  if (err instanceof UnsafeCallbackUrlError) {
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
};

const fallbackError: ErrorRequestHandler = (err, _req, res, _next) => {
  log.error({ err }, "unhandled error");
  res.status(500).json({ error: "Internal server error" });
};

app.use(zodError);
app.use(fallbackError);

const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: true },
});

io.on("connection", (socket) => {
  socket.emit("dashboard.ready", { ok: true });
});

const sub = redis.duplicate();
sub.on("error", (err: Error) => log.error({ err }, "Redis subscriber error"));
void sub
  .subscribe(EVENTS_CHANNEL)
  .then(() => {
    log.info({ channel: EVENTS_CHANNEL }, "subscribed to events channel");
  })
  .catch((err: unknown) => log.error({ err }, "Redis subscribe failed"));

sub.on("message", (_channel: string, message: string) => {
  try {
    const evt = JSON.parse(message) as CronHiveSocketEvent;
    io.emit(evt.event, evt.payload);
  } catch {
    /* ignore malformed */
  }
});

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "closing API");
  io.close();
  await new Promise<void>((resolve, reject) => {
    httpServer.close((err) => (err ? reject(err) : resolve()));
  });
  sub.disconnect();
  await redis.quit();
  await disconnectPrisma();
  process.exit(0);
}

httpServer.listen(env.API_PORT, () => {
  log.info({ port: env.API_PORT }, "API listening (/metrics, /health available)");
  if (!authEnabled()) {
    log.warn(
      "CRONHIVE_API_KEYS is not set — the management API is UNAUTHENTICATED. Set API keys before exposing this service."
    );
  }
});

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
