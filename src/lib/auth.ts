import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { loadEnv } from "../config/env.js";

/**
 * API-key authentication for the management API. Keys are supplied via the CRONHIVE_API_KEYS
 * env var (comma-separated) and presented by clients as `Authorization: Bearer <key>` or an
 * `x-api-key` header. Comparison is constant-time to avoid timing oracles.
 *
 * If no keys are configured the middleware is a no-op (open) — but the API logs a loud
 * warning at startup so this can't silently ship to production. See server.ts.
 */

function parseKeys(): string[] {
  const { CRONHIVE_API_KEYS } = loadEnv();
  return CRONHIVE_API_KEYS.split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

export function authEnabled(): boolean {
  return parseKeys().length > 0;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export const requireApiKey: RequestHandler = (req, res, next) => {
  const keys = parseKeys();
  if (keys.length === 0) {
    next(); // auth disabled
    return;
  }

  const header = req.header("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const provided = bearer ?? req.header("x-api-key");

  if (provided && keys.some((k) => safeEqual(k, provided))) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
};
