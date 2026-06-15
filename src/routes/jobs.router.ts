import { Router } from "express";
import { z } from "zod";
import {
  bulkSetEnabled,
  createJob,
  deleteJob,
  getJobById,
  listJobs,
  setPaused,
  updateJob,
} from "../services/job.service.js";
import { createExecution, getJobStats, listExecutions } from "../services/execution.service.js";
import { redis } from "../lib/redis.js";
import { acquireJobLock, releaseJobLock } from "../lib/lock.js";
import { computeJobLockTtlSeconds } from "../lib/lock-ttl.js";
import { getExecutionQueue, executionJobOptions } from "../lib/queues.js";

const router = Router();

const retryPolicySchema = z.object({
  maxRetries: z.number().int().min(0).max(50),
  backoffMs: z.number().int().min(100).max(3_600_000),
});

const createBody = z.object({
  name: z.string().min(1).max(200),
  cronExpression: z.string().min(1),
  callbackUrl: z.string().url(),
  retryPolicy: retryPolicySchema,
  timezone: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  paused: z.boolean().optional(),
  callbackTimeoutMs: z.number().int().min(1000).max(300_000).optional(),
});

const updateBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    cronExpression: z.string().min(1).optional(),
    callbackUrl: z.string().url().optional(),
    timezone: z.string().min(1).optional(),
    maxRetries: z.number().int().min(0).max(50).optional(),
    backoffMs: z.number().int().min(100).max(3_600_000).optional(),
    callbackTimeoutMs: z.number().int().min(1000).max(300_000).optional(),
    enabled: z.boolean().optional(),
    paused: z.boolean().optional(),
  })
  .strict();

const bulkBody = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  enabled: z.boolean(),
});

router.get("/", async (_req, res) => {
  const jobs = await listJobs();
  res.json(jobs);
});

router.post("/", async (req, res, next) => {
  try {
    const body = createBody.parse(req.body);
    const job = await createJob({
      name: body.name,
      cronExpression: body.cronExpression,
      callbackUrl: body.callbackUrl,
      retryPolicy: body.retryPolicy,
      timezone: body.timezone,
      enabled: body.enabled,
      paused: body.paused,
      callbackTimeoutMs: body.callbackTimeoutMs,
    });
    res.status(201).json(job);
  } catch (e) {
    next(e);
  }
});

router.post("/bulk", async (req, res, next) => {
  try {
    const body = bulkBody.parse(req.body);
    const count = await bulkSetEnabled(body.ids, body.enabled);
    res.json({ updated: count });
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res) => {
  const job = await getJobById(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(job);
});

router.put("/:id", async (req, res, next) => {
  try {
    const body = updateBody.parse(req.body);
    const job = await updateJob(req.params.id, body);
    if (!job) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(job);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res) => {
  const ok = await deleteJob(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});

router.get("/:id/executions", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const job = await getJobById(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { items, total } = await listExecutions(req.params.id, page, limit);
    res.json({
      data: items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (e) {
    next(e);
  }
});

router.get("/:id/stats", async (req, res) => {
  const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
  const stats = await getJobStats(req.params.id, days);
  if (!stats) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(stats);
});

router.post("/:id/trigger", async (req, res, next) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!job.enabled) {
      res.status(409).json({ error: "Job is disabled" });
      return;
    }
    const ttl = computeJobLockTtlSeconds(job);
    const lock = await acquireJobLock(redis, job.id, "manual", ttl);
    if (!lock) {
      res.status(409).json({ error: "Could not acquire execution lock; job may already be running" });
      return;
    }
    try {
      const ex = await createExecution(job.id, "manual");
      await getExecutionQueue().add(
        "execution",
        { executionId: ex.id, jobId: job.id, fireSlot: "manual" },
        executionJobOptions(job)
      );
      res.status(202).json(ex);
    } catch (e) {
      await releaseJobLock(redis, lock);
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

router.post("/:id/pause", async (req, res) => {
  const job = await setPaused(req.params.id, true);
  if (!job) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(job);
});

router.post("/:id/resume", async (req, res) => {
  const job = await setPaused(req.params.id, false);
  if (!job) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(job);
});

export default router;
