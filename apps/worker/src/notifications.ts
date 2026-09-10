import type { Queue } from "bullmq";
import type { PrismaClient } from "@vimla/database";
import type { WorkerConfig } from "@vimla/config";
import {
  createNotificationService,
  DELIVER_JOB_NAME,
  deliveryJobId,
  NotificationDeliveryProcessor,
  ReminderReconciler,
  redisNotificationStore,
  type EmailAdapterConfig,
  type PlatformLogger,
  type ReminderEmailSendInput,
} from "@vimla/notifications";
import { notificationDeliveryJobSchema } from "@vimla/contracts";
import { isDuplicateJobError } from "./queue.js";

export function createNotificationRuntime(
  prisma: PrismaClient,
  config: WorkerConfig,
  queue: Queue,
  redis: {
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<unknown>;
    set(key: string, value: string, expiryMode: "EX", ttl: number, setMode: "NX"): Promise<string | null>;
    del(key: string): Promise<unknown>;
  },
  logger: PlatformLogger,
) {
  const notifications = createNotificationService({
    appEnv: config.appEnv,
    secret: config.betterAuthSecret,
    defaultLocale: config.authDefaultLocale,
    email: emailAdapterFromConfig(config),
    sms: { kind: "memory" },
    store: redisNotificationStore(redis),
    limits: {
      emailRetryMax: 1,
      emailPerDestPerHour: config.notifyEmailPerDestPerHour,
      emailPerIpPerHour: config.notifyEmailPerIpPerHour,
      emailGlobalPerMinute: config.notifyEmailGlobalPerMinute,
    },
    failClosed: config.appEnv === "staging" || config.appEnv === "production",
    requiredChannels: { email: true, sms: false },
    onEvent: (event) => {
      logger.info(
        {
          channel: event.channel,
          templateId: event.templateId,
          provider: event.provider,
          success: event.success,
          latencyMs: event.latencyMs,
          errorCategory: event.errorCategory ?? null,
          retryCount: event.retryCount,
        },
        "notification_delivery",
      );
    },
  });

  async function enqueueDelivery(deliveryId: string): Promise<void> {
    try {
      await queue.add(
        DELIVER_JOB_NAME,
        { deliveryId },
        {
          jobId: deliveryJobId(deliveryId),
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error: unknown) {
      if (isDuplicateJobError(error)) {
        return;
      }
      throw error;
    }
  }

  const reconciler = new ReminderReconciler(
    prisma,
    {
      maxLatenessMinutes: config.reminderMaxLatenessMinutes,
      batchSize: config.reminderReconcileBatch,
    },
    enqueueDelivery,
    logger,
  );

  const processor = new NotificationDeliveryProcessor(
    prisma,
    {
      maxLatenessMinutes: config.reminderMaxLatenessMinutes,
      maxAttempts: config.notifyDeliveryMaxAttempts,
      backoffBaseMs: config.notifyDeliveryBackoffBaseMs,
      backoffCapMs: config.notifyDeliveryBackoffCapMs,
      leaseSeconds: config.notifyDeliveryLeaseSeconds,
      defaultLocale: config.authDefaultLocale,
      webOrigin: config.webOrigin,
    },
    async (input: ReminderEmailSendInput) =>
      notifications.sendEmailOnce({
        to: input.to,
        templateId: "reminderDue",
        locale: input.locale,
        notificationId: input.notificationId,
        userId: input.userId,
        reminderTitle: input.reminderTitle,
        scheduledLabel: input.scheduledLabel,
        openUrl: input.openUrl,
      }),
    logger,
  );

  return { reconciler, processor, enqueueDelivery, notifications };
}

export function parseDeliveryJobPayload(data: unknown): { deliveryId: string } {
  return notificationDeliveryJobSchema.parse(data);
}

function emailAdapterFromConfig(config: WorkerConfig): EmailAdapterConfig {
  if (config.emailProvider !== "smtp") {
    return { kind: "memory" };
  }
  if (!config.smtpHost || !config.smtpUser || !config.smtpPassword || !config.emailFrom) {
    throw new Error("SMTP notification configuration is incomplete");
  }
  return {
    kind: "smtp",
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    user: config.smtpUser,
    password: config.smtpPassword,
    from: config.emailFrom,
    replyTo: config.emailReplyTo,
  };
}
