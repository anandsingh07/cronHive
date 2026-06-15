import { defineConfig } from "vitest/config";

// Integration tests: spin up real Postgres via Testcontainers. Require Docker.
// Run separately because they are slower and need a container runtime.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    environment: "node",
    globals: false,
    // Container startup + migrations can take a while on first pull.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Integration tests share a single DB; run them serially to keep assertions deterministic.
    fileParallelism: false,
  },
});
