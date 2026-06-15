import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";

beforeAll(() => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://x:x@localhost:5432/x";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
  process.env.CRONHIVE_SIGNING_SECRET = "test-secret";
});

describe("callback HMAC signature", () => {
  it("invokeCallback signs the body with HMAC-SHA256 so receivers can verify authenticity", async () => {
    const { invokeCallback } = await import("../../src/services/callback.service.js");

    let receivedSig: string | null = null;
    let receivedBody: string | null = null;

    // Minimal local HTTP server to capture the signed request.
    const http = await import("node:http");
    const server = http.createServer((req, res) => {
      receivedSig = req.headers["x-cronhive-signature"] as string;
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        receivedBody = Buffer.concat(chunks).toString("utf8");
        res.writeHead(200).end("ok");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const body = { jobId: "j1", attemptNumber: 1 };
    const result = await invokeCallback(`http://127.0.0.1:${port}/hook`, body, 5000);

    server.close();

    expect(result.ok).toBe(true);
    const expected = crypto
      .createHmac("sha256", "test-secret")
      .update(receivedBody!)
      .digest("hex");
    expect(receivedSig).toBe(expected);
  });

  it("reports a timeout when the callback exceeds the timeout budget", async () => {
    const { invokeCallback } = await import("../../src/services/callback.service.js");
    const http = await import("node:http");
    const server = http.createServer((_req, res) => {
      // Never respond within the budget.
      setTimeout(() => res.writeHead(200).end("late"), 1000);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const result = await invokeCallback(`http://127.0.0.1:${port}/slow`, {}, 100);
    server.close();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("timeout");
  });
});
