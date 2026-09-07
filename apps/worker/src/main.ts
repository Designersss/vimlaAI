import { loadWorkerConfig } from "@vimla/config/server";
import { createPrismaClient, pingDatabase } from "@vimla/database";
import { createCorrelationId } from "@vimla/shared";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";
import { MAINTENANCE_QUEUE_NAME, redisConnectionOptions } from "./queue.js";

async function bootstrap(): Promise<void> {
  const config = loadWorkerConfig();
  const logger = pino({
    level: config.logLevel,
    base: {
      service: "worker",
      correlationId: createCorrelationId(),
    },
    redact: {
      paths: ["*.password", "*.secret", "*.apiKey", "*.authorization"],
      remove: true,
    },
  });

  const redisOptions = redisConnectionOptions(config.redisUrl);
  const connection = new Redis(redisOptions.url, {
    maxRetriesPerRequest: redisOptions.maxRetriesPerRequest,
  });

  await connection.ping();
  logger.info("connected to Redis");

  const prisma = createPrismaClient(config.databaseUrl);
  await pingDatabase(prisma);
  logger.info("connected to PostgreSQL");

  const worker = new Worker(
    MAINTENANCE_QUEUE_NAME,
    async (job) => {
      logger.info({ jobId: job.id, name: job.name }, "maintenance job started");
      return { ok: true as const };
    },
    { connection },
  );

  worker.on("failed", (job, error: Error) => {
    logger.error({ jobId: job?.id, err: error.message }, "maintenance job failed");
  });

  logger.info({ queue: MAINTENANCE_QUEUE_NAME }, "worker ready");

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "worker shutting down");
    await worker.close();
    await connection.quit();
    await prisma.$disconnect();
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

await bootstrap();
