import { loadWorkerConfig } from "@vimla/config/server";
import { createPrismaClient, pingDatabase } from "@vimla/database";
import { createCorrelationId } from "@vimla/shared";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";
import { createWorkerPaymentService } from "./payment-reconciliation.js";
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
      paths: ["*.password", "*.secret", "*.apiKey", "*.authorization", "*.Token", "tbankPassword"],
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

  const billingLogger = {
    info: (fields: Record<string, string | number | boolean | null>, message: string) => {
      logger.info(fields, message);
    },
    warn: (fields: Record<string, string | number | boolean | null>, message: string) => {
      logger.warn(fields, message);
    },
    error: (fields: Record<string, string | number | boolean | null>, message: string) => {
      logger.error(fields, message);
    },
  };
  const payments = createWorkerPaymentService(prisma, config, billingLogger);
  const reconcileAfterMs = config.paymentReconcileAfterSeconds * 1000;

  const worker = new Worker(
    MAINTENANCE_QUEUE_NAME,
    async (job) => {
      if (job.name === "reconcile-payments") {
        const olderThan = new Date(Date.now() - reconcileAfterMs);
        const fulfilled = await payments.reconcilePending(olderThan, 25);
        return { ok: true as const, fulfilled };
      }
      logger.info({ jobId: job.id, name: job.name }, "maintenance job started");
      return { ok: true as const };
    },
    { connection },
  );

  const reconcileTimer = setInterval(() => {
    void payments
      .reconcilePending(new Date(Date.now() - reconcileAfterMs), 25)
      .catch((error: unknown) => {
        logger.error(
          { err: error instanceof Error ? error.message : "unknown" },
          "payment reconciliation loop failed",
        );
      });
  }, Math.max(reconcileAfterMs, 60_000));

  worker.on("failed", (job, error: Error) => {
    logger.error({ jobId: job?.id, err: error.message }, "maintenance job failed");
  });

  logger.info({ queue: MAINTENANCE_QUEUE_NAME }, "worker ready");

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "worker shutting down");
    clearInterval(reconcileTimer);
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
