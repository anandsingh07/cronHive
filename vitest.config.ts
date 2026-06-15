import { defineConfig } from "vitest/config";

// Unit tests: pure logic, no external infrastructure. Fast, run everywhere.
export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
