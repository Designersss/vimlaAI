import { loadWorkerConfig } from "@vimla/config/server";
import { createPrismaClient, pingDatabase } from "@vimla/database";
import {
  DELIVER_JOB_NAME,
  NOTIFICATIONS_QUEUE_NAME,
  RECONCILE_JOB_NAME,
  RECONCILE_SCHEDULER_ID,
} from "@vimla/notifications";
import { createCorrelationId } from "@vimla/shared";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";
import { closeHttpServer, listenWorkerHealth } from "./health.js";
import { createNotificationRuntime, parseDeliveryJobPayload } from "./notifications.js";
import { createWorkerPaymentService } from "./payment-reconciliation.js";
import { createAiReconciler } from "./ai-reconciliation.js";
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
  const maintenanceConnection = new Redis(redisOptions.url, {
    maxRetriesPerRequest: redisOptions.maxRetriesPerRequest,
  });
  const notificationConnection = new Redis(redisOptions.url, {
    maxRetriesPerRequest: redisOptions.maxRetriesPerRequest,
  });
  const queueConnection = new Redis(redisOptions.url, {
    maxRetriesPerRequest: redisOptions.maxRetriesPerRequest,
  });
  const storeConnection = new Redis(redisOptions.url, {
    maxRetriesPerRequest: redisOptions.maxRetriesPerRequest,
  });

  await storeConnection.ping();
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
  const aiReconciler = createAiReconciler(prisma, config, billingLogger);
  const reconcileAfterMs = config.paymentReconcileAfterSeconds * 1000;
  const aiReconcileAfterMs = 5 * 60_000;
  const notificationQueue = new Queue(NOTIFICATIONS_QUEUE_NAME, { connection: queueConnection });
  const notifications = createNotificationRuntime(
    prisma,
    config,
    notificationQueue,
    storeConnection,
    billingLogger,
  );

  const maintenanceWorker = new Worker(
    MAINTENANCE_QUEUE_NAME,
    async (job) => {
      if (job.name === "reconcile-payments") {
        const olderThan = new Date(Date.now() - reconcileAfterMs);
        const fulfilled = await payments.reconcilePending(olderThan, 25);
        return { ok: true as const, fulfilled };
      }
      if (job.name === "reconcile-ai-requests") {
        const counters = await aiReconciler.reconcile(new Date(Date.now() - aiReconcileAfterMs), 50);
        return { ok: true as const, counters };
      }
      logger.info({ jobId: job.id, name: job.name }, "maintenance job started");
      return { ok: true as const };
    },
    { connection: maintenanceConnection },
  );

  const notificationWorker = new Worker(
    NOTIFICATIONS_QUEUE_NAME,
    async (job) => {
      if (job.name === RECONCILE_JOB_NAME) {
        const counters = await notifications.reconciler.reconcile();
        return { ok: true as const, counters };
      }
      if (job.name === DELIVER_JOB_NAME) {
        const payload = parseDeliveryJobPayload(job.data);
        const result = await notifications.processor.process(payload.deliveryId);
        return { ok: true as const, ...result };
      }
      logger.info({ jobId: job.id, name: job.name }, "notification job started");
      return { ok: true as const };
    },
    { connection: notificationConnection, concurrency: 4 },
  );

  maintenanceWorker.on("error", (error: Error) => {
    logger.error({ err: error.message }, "maintenance worker error");
  });
  notificationWorker.on("error", (error: Error) => {
    logger.error({ err: error.message }, "notification worker error");
  });
  await maintenanceWorker.waitUntilReady();
  await notificationWorker.waitUntilReady();

  await notificationQueue.upsertJobScheduler(
    RECONCILE_SCHEDULER_ID,
    { every: config.reminderReconcileIntervalSeconds * 1000 },
    {
      name: RECONCILE_JOB_NAME,
      data: { reason: "repeat" },
    },
  );
  const startupCounters = await notifications.reconciler.reconcile();
  logger.info(startupCounters, "reminder.reconcile.startup");

  const paymentTimer = setInterval(() => {
    void payments
      .reconcilePending(new Date(Date.now() - reconcileAfterMs), 25)
      .catch((error: unknown) => {
        logger.error(
          { err: error instanceof Error ? error.message : "unknown" },
          "payment reconciliation loop failed",
        );
      });
  }, Math.max(reconcileAfterMs, 60_000));
  const aiReconciliationTimer = setInterval(() => {
    void aiReconciler.reconcile(new Date(Date.now() - aiReconcileAfterMs), 50).then(
      (counters) => logger.info(counters, "ai.reconcile.completed"),
      (error: unknown) => logger.error(
        { err: error instanceof Error ? error.message : "unknown" },
        "ai reconciliation loop failed",
      ),
    );
  }, 60_000);
  const startupAiCounters = await aiReconciler.reconcile(new Date(Date.now() - aiReconcileAfterMs), 50);
  logger.info(startupAiCounters, "ai.reconcile.startup");

  maintenanceWorker.on("failed", (job, error: Error) => {
    logger.error({ jobId: job?.id, err: error.message }, "maintenance job failed");
  });
  notificationWorker.on("failed", (job, error: Error) => {
    logger.error({ jobId: job?.id, err: error.message }, "notification job failed");
  });

  const healthServer =
    config.workerHealthPort !== undefined
      ? await listenWorkerHealth(config.workerHealthPort)
      : undefined;

  logger.info(
    {
      maintenanceQueue: MAINTENANCE_QUEUE_NAME,
      notificationQueue: NOTIFICATIONS_QUEUE_NAME,
      workerHealthPort: config.workerHealthPort ?? null,
    },
    "worker ready",
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "worker shutting down");
    clearInterval(paymentTimer);
    clearInterval(aiReconciliationTimer);
    await closeHttpServer(healthServer);
    await notificationWorker.close();
    await maintenanceWorker.close();
    await notificationQueue.close();
    await queueConnection.quit();
    await maintenanceConnection.quit();
    await notificationConnection.quit();
    await storeConnection.quit();
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
