import http from "node:http";
import { registry } from "./metrics.js";
import { logger } from "./logger.js";

/**
 * Lightweight standalone /metrics endpoint for processes that aren't the API (scheduler,
 * worker). Each process exposes its own Prometheus metrics on its own port; a Prometheus
 * server scrapes all of them. This keeps per-process counters accurate in a multi-process
 * deployment (the alternative — a shared registry across processes — isn't possible).
 */
export function startMetricsServer(port: number, component: string): http.Server {
  const log = logger.child({ component });
  const server = http.createServer((req, res) => {
    if (req.url === "/metrics") {
      registry
        .metrics()
        .then((body) => {
          res.writeHead(200, { "content-type": registry.contentType });
          res.end(body);
        })
        .catch((err) => {
          res.writeHead(500).end(String(err));
        });
      return;
    }
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", component }));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port, () => log.info({ port }, "metrics server listening"));
  return server;
}
