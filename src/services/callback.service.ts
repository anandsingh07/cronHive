import crypto from "node:crypto";
import { loadEnv } from "../config/env.js";

export type CallbackResult =
  | { ok: true; statusCode: number; durationMs: number }
  | { ok: false; kind: "http_error" | "timeout" | "network"; statusCode?: number; message: string; durationMs: number };

export async function invokeCallback(
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<CallbackResult> {
  const env = loadEnv();
  const started = Date.now();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  const bodyString = JSON.stringify(body);
  const signature = crypto
    .createHmac("sha256", env.CRONHIVE_SIGNING_SECRET)
    .update(bodyString)
    .digest("hex");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { 
        "content-type": "application/json",
        "X-CronHive-Signature": signature,
      },
      body: bodyString,
      signal: controller.signal,
    });
    const durationMs = Date.now() - started;
    clearTimeout(t);
    if (res.ok) {
      return { ok: true, statusCode: res.status, durationMs };
    }
    return {
      ok: false,
      kind: "http_error",
      statusCode: res.status,
      message: `HTTP ${res.status}`,
      durationMs,
    };
  } catch (e) {
    const durationMs = Date.now() - started;
    clearTimeout(t);
    const err = e as Error;
    if (err.name === "AbortError") {
      return { ok: false, kind: "timeout", message: "Callback timeout", durationMs };
    }
    return { ok: false, kind: "network", message: err.message ?? "Network error", durationMs };
  }
}
