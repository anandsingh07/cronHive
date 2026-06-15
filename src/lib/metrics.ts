import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";

/**
 * Central Prometheus registry. Each process (api/scheduler/worker) imports this and
 * exposes (or pushes) the metrics relevant to it. The API process serves /metrics.
 */
export const registry = new Registry();

collectDefaultMetrics({ register: registry, prefix: "cronhive_" });

// --- Execution outcomes (worker) ---
export const executionsTotal = new Counter({
  name: "cronhive_executions_total",
  help: "Total job executions by terminal status",
  labelNames: ["status"] as const, // SUCCESS | FAILED | DEAD
  registers: [registry],
});

export const executionDuration = new Histogram({
  name: "cronhive_execution_duration_seconds",
  help: "Wall-clock duration of a callback invocation",
  labelNames: ["status"] as const,
  // Buckets tuned for HTTP callbacks: 5ms .. 60s
  buckets: [0.005, 0.025, 0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [registry],
});

export const callbackAttemptsTotal = new Counter({
  name: "cronhive_callback_attempts_total",
  help: "Total callback attempts (including retries)",
  labelNames: ["outcome"] as const, // ok | http_error | timeout | network
  registers: [registry],
});

// --- Scheduler ---
export const schedulerTicksTotal = new Counter({
  name: "cronhive_scheduler_ticks_total",
  help: "Number of scheduler scan ticks",
  registers: [registry],
});

export const slotsEnqueuedTotal = new Counter({
  name: "cronhive_slots_enqueued_total",
  help: "Cron fire-slots successfully enqueued for execution",
  registers: [registry],
});

export const slotsDedupedTotal = new Counter({
  name: "cronhive_slots_deduped_total",
  help: "Fire-slots skipped because they were already claimed (double-fire prevented)",
  registers: [registry],
});

export const schedulerTickDuration = new Histogram({
  name: "cronhive_scheduler_tick_duration_seconds",
  help: "Duration of a single scheduler scan tick",
  buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [registry],
});

// --- Circuit breaker ---
export const circuitOpenTotal = new Counter({
  name: "cronhive_circuit_open_total",
  help: "Number of times a job's circuit breaker opened (job auto-disabled)",
  registers: [registry],
});

// --- Leadership (set in Phase 6) ---
export const isLeaderGauge = new Gauge({
  name: "cronhive_scheduler_is_leader",
  help: "1 if this scheduler instance currently holds leadership, else 0",
  registers: [registry],
});
