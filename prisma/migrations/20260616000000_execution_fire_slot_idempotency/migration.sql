-- Phase 1: fire-slot idempotency to eliminate double-firing.
-- Adds the exact cron fire-time slot to each execution and enforces one execution
-- per (job, scheduled fire-time) at the database level. This is the correctness
-- guarantee against double-firing, independent of Redis lock timing or scheduler replica count.

-- 1. Add the nullable fire-slot column (manual triggers leave it null).
ALTER TABLE "Execution" ADD COLUMN "scheduledFor" TIMESTAMP(3);

-- 2. Enforce uniqueness per (job, fire-slot).
--    Postgres treats NULLs as distinct, so multiple manual executions (scheduledFor = NULL)
--    remain allowed; only scheduled fires for the same slot collide.
CREATE UNIQUE INDEX "Execution_jobId_scheduledFor_key" ON "Execution"("jobId", "scheduledFor");
