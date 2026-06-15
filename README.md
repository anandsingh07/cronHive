# 🐝 CronHive

A **distributed, fault-tolerant cron job scheduler** that triggers HTTP callbacks on a schedule with at-least-once delivery, exponential-backoff retries, dead-letter queues, and a circuit breaker. Designed to run as multiple independent, horizontally-scalable processes coordinated through Redis and PostgreSQL.

> **Why it exists:** a correct distributed scheduler is deceptively hard — the central challenge is guaranteeing a job fires **exactly once per scheduled slot** even when multiple scheduler replicas race, callbacks are slow, or a node dies mid-execution. CronHive solves this at the database level and proves it with a concurrency test.

## 📌 About

**What it is:** a horizontally-scalable cron scheduler that fires HTTP callbacks on a schedule with at-least-once delivery, retries, dead-letter queues, and a circuit breaker.

**How it works:** multiple stateless processes (API · scheduler · worker) coordinate through Redis + PostgreSQL. The scheduler computes each cron **fire-slot**, inserts an `Execution` row guarded by a `UNIQUE(jobId, scheduledFor)` constraint (so concurrent replicas can never double-fire), then enqueues to BullMQ. Workers run the callback with exponential-backoff retries, dead-letter on exhaustion, and a circuit breaker that disables chronically-failing jobs. Leader election ensures only one scheduler scans at a time, with automatic failover.

**Tech:** Node 22 · TypeScript · Express · BullMQ · PostgreSQL/Prisma · Redis · Socket.IO · prom-client · pino · Vitest + Testcontainers · Next.js dashboard · Docker.

## ✨ Highlights

- **Exactly-once-per-slot firing**, guaranteed by a database unique constraint on `(jobId, scheduledFor)` — not by lock timing. Proven by an integration test: **50 concurrent claims on one fire-slot → exactly 1 execution** ([test/integration/double-fire.test.ts](test/integration/double-fire.test.ts)).
- **Safe distributed locking** with an owner-token + Lua compare-and-delete release, so a holder can never delete another node's lock (the classic Redis lock bug) ([src/lib/lock.ts](src/lib/lock.ts)).
- **Leader election** so only one scheduler replica scans at a time, with automatic failover when the leader dies ([src/lib/leader.ts](src/lib/leader.ts)).
- **BullMQ-native retries** — a single retry mechanism with exponential backoff, dead-letter queue, and a circuit breaker that auto-disables chronically failing jobs.
- **First-class observability** — Prometheus `/metrics` on every process, structured JSON logs (pino), and deep readiness checks (`/health` verifies Postgres + Redis).
- **Security baseline** — API-key auth, SSRF protection on callback URLs (blocks loopback/private/cloud-metadata ranges), and per-IP rate limiting.
- **Tested & CI'd** — 19 unit + 8 integration tests (Testcontainers spins up real Postgres & Redis), run on GitHub Actions.

## 🏗️ Architecture

Three independently-scalable Node processes share PostgreSQL (durable state) and Redis (queue + coordination):

```mermaid
flowchart LR
  subgraph clients [Clients]
    D[Dashboard / API consumers]
  end
  subgraph api [API Process]
    E[Express REST + auth + rate limit]
    S[Socket.IO]
    M1[/metrics, /health/]
  end
  subgraph sched [Scheduler Processes x N]
    L[Leader election]
    T[Scan tick - leader only]
  end
  subgraph work [Worker Processes x N]
    W[BullMQ worker - native retries]
  end
  PG[(PostgreSQL)]
  RD[(Redis: queue + locks + leader lease + pub/sub)]
  Q[cronhive execution queue]
  DLQ[dead-letter queue]
  CB[Your callback URLs]

  D --> E
  D <-->|WebSocket| S
  E --> PG
  L --> RD
  T --> PG
  T -->|fire-slot lock| RD
  T -->|enqueue| Q
  W --> Q
  W -->|exhausted retries| DLQ
  W --> PG
  W -->|HMAC-signed POST| CB
  W -->|publish events| RD
  RD -->|pub/sub| S
```

### How exactly-once-per-slot works

1. The scheduler resolves the precise cron **fire-slot** timestamp for the current window (`dueFireSlot`), which is stable across ticks and replicas.
2. It takes a best-effort Redis lock keyed on `(jobId, fireSlot)` — a fast-path to avoid redundant work.
3. It inserts an `Execution` row with that `scheduledFor`. The unique constraint `@@unique([jobId, scheduledFor])` means **any concurrent duplicate insert fails with P2002 and is silently skipped.** This is the real guarantee — independent of lock timing, clock skew, or replica count.
4. The job is enqueued to BullMQ, which owns retries/backoff. The worker records each attempt and dead-letters on exhaustion.

Manual triggers use `scheduledFor = NULL` (NULLs are distinct under the unique index), so they are intentionally never deduplicated against scheduled fires.

## 🚀 Quick Start (Docker)

```bash
git clone https://github.com/anandsingh07/cronHive.git
cd cronHive
docker compose up -d --build
```

- Dashboard → http://localhost:3000
- API → http://localhost:4000 (`/health`, `/metrics`)

Scale schedulers safely — leader election guarantees only one scans:

```bash
docker compose up -d --scale scheduler=3 --scale worker=4
```

## 💻 Local Development

```bash
npm install
# create a .env from the template below, then edit DB/Redis URLs
npx prisma migrate deploy
npm run dev:stack             # api + scheduler + worker + dashboard
```

### Environment variables

Create a `.env` file in the project root with the following (copy this block):

```dotenv
NODE_ENV=development

# --- Datastores ---
# Create user + DB in PostgreSQL first, e.g.:
#   CREATE USER cronhive WITH PASSWORD 'cronhive';
#   CREATE DATABASE cronhive OWNER cronhive;
# Use 127.0.0.1 on Windows if localhost fails (IPv6 vs IPv4).
DATABASE_URL=postgresql://cronhive:cronhive@127.0.0.1:5432/cronhive
REDIS_URL=redis://127.0.0.1:6379
API_PORT=4000

# --- Callback signing ---
# REQUIRED in production: receivers verify the X-CronHive-Signature HMAC.
CRONHIVE_SIGNING_SECRET=replace_this_with_a_secure_secret

# --- Auth & security ---
# Comma-separated API keys for the management API. Leave empty to DISABLE auth (dev only;
# the API logs a warning at startup if unset).
CRONHIVE_API_KEYS=
# Allow callback URLs that resolve to private/loopback addresses (dev only; SSRF guard).
CRONHIVE_ALLOW_PRIVATE_CALLBACKS=false
# Per-IP rate limit on the management API.
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000

# --- Retry / circuit breaker ---
# Lock TTL buffer beyond worst-case callback + retries (ms)
LOCK_BUFFER_MS=10000
# Auto-disable a job after N consecutive DEAD executions
CIRCUIT_BREAKER_CONSECUTIVE_DEAD=10
DEFAULT_CALLBACK_TIMEOUT_MS=30000

# --- Scheduler ---
# How often the scheduler scans cron schedules (ms)
SCHEDULER_SCAN_MS=60000
# Only the elected leader scans when true (safe to run multiple scheduler replicas).
SCHEDULER_LEADER_ELECTION=true
# Leader lease TTL; a dead leader fails over within ~this window (ms).
LEADER_LEASE_MS=10000

# --- Workers ---
WORKER_CONCURRENCY=5

# --- Observability ---
LOG_LEVEL=info
SCHEDULER_METRICS_PORT=9101
WORKER_METRICS_PORT=9102
```

## ✅ Testing

```bash
npm test               # unit tests (fast, no infra)
npm run test:integration   # spins up real Postgres + Redis via Testcontainers (needs Docker)
npm run test:all
```

The integration suite proves the hard properties end-to-end:

| Test | Proves |
|------|--------|
| `double-fire.test.ts` | 50 concurrent claims on one slot → exactly 1 execution |
| `retry-dlq.test.ts` | callback retried exactly `attempts` times → DEAD, no duplicate executions |
| `lock.test.ts` | a stale holder cannot release another owner's lock |
| `leader.test.ts` | exactly one leader at a time; automatic failover |

## 📡 API

Auth: send `Authorization: Bearer <key>` (or `x-api-key`) when `CRONHIVE_API_KEYS` is set.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/jobs` | List jobs |
| `POST` | `/jobs` | Register a cron job (callback URL is SSRF-checked) |
| `GET` | `/jobs/:id` | Get a job |
| `PUT` | `/jobs/:id` | Update a job |
| `DELETE` | `/jobs/:id` | Delete a job |
| `POST` | `/jobs/:id/trigger` | Manually trigger an execution |
| `POST` | `/jobs/:id/pause` · `/resume` | Pause / resume scheduling |
| `GET` | `/jobs/:id/executions` | Execution history (paginated) |
| `GET` | `/jobs/:id/stats` | Success rate / latency stats |
| `GET` | `/health` · `/health/live` | Readiness (DB+Redis) / liveness |
| `GET` | `/metrics` | Prometheus metrics |

## 📊 Observability

Every process exposes Prometheus metrics (API on `/metrics`; scheduler/worker on `SCHEDULER_METRICS_PORT`/`WORKER_METRICS_PORT`). Key series:

- `cronhive_executions_total{status}` — SUCCESS / FAILED / DEAD counts
- `cronhive_execution_duration_seconds` — callback latency histogram
- `cronhive_slots_enqueued_total` / `cronhive_slots_deduped_total` — fire-slots enqueued vs. double-fires prevented
- `cronhive_scheduler_is_leader` — current leadership (1/0)
- `cronhive_circuit_open_total` — circuit-breaker trips

## 🧱 Tech Stack

Node.js 22 · TypeScript · Express · BullMQ · PostgreSQL (Prisma) · Redis (ioredis) · Socket.IO · prom-client · pino · Zod · Vitest + Testcontainers · Next.js 16 (dashboard) · Docker (multi-stage, non-root).

## 🛡️ License

MIT.
