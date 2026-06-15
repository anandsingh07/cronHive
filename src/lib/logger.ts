import { pino } from "pino";
import { loadEnv } from "../config/env.js";

const env = loadEnv();

/**
 * Structured JSON logger. JSON in production for log aggregators; pretty-printed in
 * development if pino-pretty is available. Create child loggers per component with
 * `logger.child({ component: "scheduler" })` so every line carries context.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "cronhive" },
  formatters: {
    level: (label) => ({ level: label }),
  },
});

export type Logger = typeof logger;
