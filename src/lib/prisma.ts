import { PrismaClient } from "@prisma/client";
import { loadEnv } from "../config/env.js";

loadEnv();

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
});

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
