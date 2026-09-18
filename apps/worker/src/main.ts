import { loadWorkerConfig } from "@vimla/config/server";
import { createPrismaClient, pingDatabase } from "@vimla/database";
import {
  DELIVER_JOB_NAME,
  NOTIFICATIONS_QUEUE_NAME,
  RECONCILE_JOB_NAME,
  RECONCILE_SCHEDULER_ID,
} from "@vimla/notifications";
import { createCorrelationId, type VimlaLocale } from "@vimla/shared";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";
import { closeHttpServer, listenWorkerHealth } from "./health.js";
import { createNotificationRuntime, parseDeliveryJobPayload } from "./notifications.js";
import {
  MockInvocationExecutorRegistry,
  OrchestrationRuntime,
  parseInvocationExecutePayload,
  parseOrchestrationDispatchPayload,
  type QueuePublisher,
  type RuntimeLogger,
} from "./orchestration.js";
import {
  DeterministicVimlaToolPlanner,
  VimlaAwareInvocationExecutorRegistry,
  VimlaInvocationExecutor,
} from "./vimla-invocation-executor.js";
import { createWorkerPaymentService } from "./payment-reconciliation.js";
import {
  INVOCATION_EXECUTE_JOB_NAME,
  INVOCATION_EXECUTE_QUEUE_NAME,
  MAINTENANCE_QUEUE_NAME,
  ORCHESTRATION_DISPATCH_JOB_NAME,
  ORCHESTRATION_DISPATCH_QUEUE_NAME,
  ORCHESTRATION_RECONCILE_INTERVAL_MS,
  ORCHESTRATION_RECONCILE_JOB_NAME,
  ORCHESTRATION_RECONCILE_SCHEDULER_ID,
  redisConnectionOptions,
} from "./queue.js";

type OrchestrationResources = {
  dispatchQueue: Queue;
  executionQueue: Queue;
  dispatchWorker: Worker;
  executionWorker: Worker;
  dispatchConnection: Redis;
  executionConnection: Redis;
  reconcileTimer: NodeJS.Timeout;
};

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

  const billingLogger: RuntimeLogger = {
    info: (fields, message) => {
      logger.info(fields, message);
    },
    warn: (fields, message) => {
      logger.warn(fields, message);
    },
    error: (fields, message) => {
      logger.error(fields, message);
    },
  };
  const payments = createWorkerPaymentService(prisma, config, billingLogger);
  const reconcileAfterMs = config.paymentReconcileAfterSeconds * 1000;
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

  const orchestrationResources =
    config.appEnv === "local" || config.appEnv === "test"
      ? await startOrchestrationRuntime(
          prisma,
          queueConnection,
          redisOptions.url,
          billingLogger,
          config.authDefaultLocale,
        )
      : undefined;

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
      orchestrationPreviewEnabled: orchestrationResources !== undefined,
      workerHealthPort: config.workerHealthPort ?? null,
    },
    "worker ready",
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "worker shutting down");
    clearInterval(paymentTimer);
    if (orchestrationResources) {
      clearInterval(orchestrationResources.reconcileTimer);
    }
    await closeHttpServer(healthServer);
    if (orchestrationResources) {
      await orchestrationResources.executionWorker.close();
      await orchestrationResources.dispatchWorker.close();
      await orchestrationResources.executionQueue.close();
      await orchestrationResources.dispatchQueue.close();
      await orchestrationResources.executionConnection.quit();
      await orchestrationResources.dispatchConnection.quit();
    }
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

async function startOrchestrationRuntime(
  prisma: ReturnType<typeof createPrismaClient>,
  queueConnection: Redis,
  redisUrl: string,
  runtimeLogger: RuntimeLogger,
  defaultLocale: VimlaLocale,
): Promise<OrchestrationResources> {
  const dispatchConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const executionConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const dispatchQueue = new Queue(ORCHESTRATION_DISPATCH_QUEUE_NAME, { connection: queueConnection });
  const executionQueue = new Queue(INVOCATION_EXECUTE_QUEUE_NAME, { connection: queueConnection });
  const executorRegistry = new VimlaAwareInvocationExecutorRegistry(
    new VimlaInvocationExecutor(
      prisma,
      new DeterministicVimlaToolPlanner(),
      defaultLocale,
    ),
    new MockInvocationExecutorRegistry(),
  );
  const runtime = new OrchestrationRuntime(
    prisma,
    queuePublisher(dispatchQueue),
    queuePublisher(executionQueue),
    runtimeLogger,
    { executorRegistry },
  );

  const dispatchWorker = new Worker(
    ORCHESTRATION_DISPATCH_QUEUE_NAME,
    async (job) => {
      if (job.name === ORCHESTRATION_RECONCILE_JOB_NAME) {
        await runtime.reconcile();
        return { ok: true as const };
      }
      if (job.name === ORCHESTRATION_DISPATCH_JOB_NAME) {
        const payload = parseOrchestrationDispatchPayload(job.data);
        await runtime.dispatchPlan(payload.planId);
        return { ok: true as const };
      }
      runtimeLogger.info(
        { jobId: job.id ?? null, name: job.name },
        "unknown orchestration dispatch job",
      );
      return { ok: true as const };
    },
    { connection: dispatchConnection, concurrency: 4 },
  );

  const executionWorker = new Worker(
    INVOCATION_EXECUTE_QUEUE_NAME,
    async (job) => {
      if (job.name === INVOCATION_EXECUTE_JOB_NAME) {
        const payload = parseInvocationExecutePayload(job.data);
        await runtime.processInvocation(payload.planId, payload.invocationId);
        return { ok: true as const };
      }
      runtimeLogger.info(
        { jobId: job.id ?? null, name: job.name },
        "unknown invocation execution job",
      );
      return { ok: true as const };
    },
    { connection: executionConnection, concurrency: 16 },
  );

  dispatchWorker.on("error", (error: Error) => {
    runtimeLogger.error({ err: error.message }, "orchestration dispatch worker error");
  });
  executionWorker.on("error", (error: Error) => {
    runtimeLogger.error({ err: error.message }, "orchestration execution worker error");
  });
  dispatchWorker.on("failed", (job, error: Error) => {
    runtimeLogger.error(
      { jobId: job?.id ?? null, err: error.message },
      "orchestration dispatch job failed",
    );
  });
  executionWorker.on("failed", (job, error: Error) => {
    runtimeLogger.error(
      { jobId: job?.id ?? null, err: error.message },
      "orchestration execution job failed",
    );
  });

  await dispatchWorker.waitUntilReady();
  await executionWorker.waitUntilReady();
  await dispatchQueue.upsertJobScheduler(
    ORCHESTRATION_RECONCILE_SCHEDULER_ID,
    { every: ORCHESTRATION_RECONCILE_INTERVAL_MS },
    { name: ORCHESTRATION_RECONCILE_JOB_NAME, data: { reason: "repeat" } },
  );
  await runtime.reconcile();

  const reconcileTimer = setInterval(() => {
    void runtime.reconcile().catch((error: unknown) => {
      runtimeLogger.error(
        { err: error instanceof Error ? error.message : "unknown" },
        "orchestration reconciliation loop failed",
      );
    });
  }, ORCHESTRATION_RECONCILE_INTERVAL_MS);

  runtimeLogger.info(
    {
      dispatchQueue: ORCHESTRATION_DISPATCH_QUEUE_NAME,
      executionQueue: INVOCATION_EXECUTE_QUEUE_NAME,
    },
    "orchestration preview runtime ready",
  );

  return {
    dispatchQueue,
    executionQueue,
    dispatchWorker,
    executionWorker,
    dispatchConnection,
    executionConnection,
    reconcileTimer,
  };
}

function queuePublisher(queue: Queue): QueuePublisher {
  return {
    add: async (name, data, options) => queue.add(name, data, options),
  };
}

await bootstrap();
