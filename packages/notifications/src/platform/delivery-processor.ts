import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@vimla/database";
import { parseVimlaLocale, type VimlaLocale } from "@vimla/shared";
import { evaluateReminderDelivery, type ReminderSourceState } from "./eligibility.js";
import { reminderHrefPath, reminderOpenUrl } from "./destinations.js";
import { formatReminderInstant } from "./format-time.js";
import type { PlatformLogger } from "./logger.js";
import { resolveReminderPreferences } from "./preferences.js";
import { classifyDeliveryError, nextAttemptAt, shouldRetry } from "./retry-policy.js";
import { sanitizeUserText } from "./text.js";
import { isPrismaUniqueConflict } from "./prisma-errors.js";

export interface ReminderEmailSendInput {
  to: string;
  locale: VimlaLocale;
  notificationId: string;
  userId: string;
  reminderTitle: string;
  scheduledLabel: string;
  openUrl?: string;
}

export interface DeliveryProcessorPolicy {
  maxLatenessMinutes: number;
  maxAttempts: number;
  backoffBaseMs: number;
  backoffCapMs: number;
  leaseSeconds: number;
  defaultLocale: VimlaLocale;
  webOrigin: string;
}

export class NotificationDeliveryProcessor {
  constructor(
    private readonly db: PrismaClient,
    private readonly policy: DeliveryProcessorPolicy,
    private readonly sendReminderEmail: (input: ReminderEmailSendInput) => Promise<{
      duplicate: boolean;
      providerMessageId?: string;
    }>,
    private readonly logger: PlatformLogger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(deliveryId: string): Promise<{ outcome: string }> {
    const now = this.now();
    const existing = await this.db.notificationDelivery.findUnique({
      where: { id: deliveryId },
    });
    if (!existing) {
      this.logger.warn({ deliveryId }, "notification.delivery.missing");
      return { outcome: "missing" };
    }
    if (existing.status === "DELIVERED" || existing.status === "FAILED" || existing.status === "SKIPPED") {
      return { outcome: "already_terminal" };
    }

    const claimed = await this.claim(deliveryId, now);
    if (!claimed) {
      return { outcome: "not_claimed" };
    }

    const delivery = await this.db.notificationDelivery.findUnique({
      where: { id: deliveryId },
    });
    if (!delivery) {
      return { outcome: "missing" };
    }

    const reminder = await this.loadReminder(delivery.sourceId);
    const user = await this.db.user.findUnique({
      where: { id: delivery.userId },
      include: { preference: true },
    });
    const preferences = resolveReminderPreferences(user?.preference);
    const decision = evaluateReminderDelivery({
      deliveryUserId: delivery.userId,
      channel: delivery.channel === "EMAIL" ? "EMAIL" : "IN_APP",
      occurrenceKey: delivery.occurrenceKey,
      scheduledFor: delivery.scheduledFor,
      now,
      maxLatenessMinutes: this.policy.maxLatenessMinutes,
      reminder,
      preferences,
      emailVerified: user?.emailVerified === true,
      hasEmail: Boolean(user?.email),
    });

    if (decision.action === "skip") {
      await this.markSkipped(delivery.id, decision.reason, now);
      this.logger.info(
        {
          deliveryId: delivery.id,
          reminderId: delivery.sourceId,
          channel: delivery.channel,
          status: "SKIPPED",
          attempt: delivery.attemptCount,
          errorClass: "final",
        },
        "notification.delivery.skipped",
      );
      return { outcome: `skipped:${decision.reason}` };
    }

    if (!reminder || !user) {
      await this.markSkipped(delivery.id, "source_unavailable", now);
      return { outcome: "skipped:source_unavailable" };
    }

    if (delivery.channel === "IN_APP") {
      const locale = parseVimlaLocale(user.preference?.locale, this.policy.defaultLocale);
      const notificationId = await this.deliverInApp(
        delivery.userId,
        reminder,
        delivery.occurrenceKey,
        formatReminderInstant({
          instant: reminder.scheduledAt,
          timeZone: reminder.timezone,
          locale,
        }),
      );
      await this.markDelivered(delivery.id, now, { userNotificationId: notificationId });
      await this.markReminderDelivered(reminder.reminderId, now);
      this.logger.info(
        {
          deliveryId: delivery.id,
          reminderId: reminder.reminderId,
          channel: "IN_APP",
          status: "DELIVERED",
          attempt: delivery.attemptCount,
        },
        "notification.delivery.delivered",
      );
      return { outcome: "delivered" };
    }

    const locale = parseVimlaLocale(user.preference?.locale, this.policy.defaultLocale);
    try {
      const result = await this.sendReminderEmail({
        to: user.email,
        locale,
        notificationId: delivery.id,
        userId: user.id,
        reminderTitle: sanitizeUserText(reminder.title, 200),
        scheduledLabel: formatReminderInstant({
          instant: reminder.scheduledAt,
          timeZone: reminder.timezone,
          locale,
        }),
        openUrl: reminderOpenUrl(this.policy.webOrigin),
      });
      await this.markDelivered(delivery.id, now, {
        providerMessageId: result.providerMessageId ?? (result.duplicate ? "duplicate" : null),
      });
      await this.markReminderDelivered(reminder.reminderId, now);
      this.logger.info(
        {
          deliveryId: delivery.id,
          reminderId: reminder.reminderId,
          channel: "EMAIL",
          status: "DELIVERED",
          attempt: delivery.attemptCount,
        },
        "notification.delivery.delivered",
      );
      return { outcome: result.duplicate ? "delivered_duplicate" : "delivered" };
    } catch (error: unknown) {
      const classified = classifyDeliveryError(error);
      const attemptCount = delivery.attemptCount;
      if (shouldRetry({
        errorClass: classified.errorClass,
        attemptCount,
        maxAttempts: this.policy.maxAttempts,
      })) {
        const retryAt = nextAttemptAt({
          attemptCount,
          now,
          backoffBaseMs: this.policy.backoffBaseMs,
          backoffCapMs: this.policy.backoffCapMs,
        });
        await this.db.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "RETRYABLE",
            nextAttemptAt: retryAt,
            processingToken: null,
            processingUntil: null,
            errorCode: classified.category,
            errorClass: classified.errorClass,
          },
        });
        this.logger.warn(
          {
            deliveryId: delivery.id,
            reminderId: reminder.reminderId,
            channel: "EMAIL",
            status: "RETRYABLE",
            attempt: attemptCount,
            errorClass: classified.errorClass,
          },
          "notification.delivery.retryable",
        );
        return { outcome: "retryable" };
      }
      await this.db.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "FAILED",
          failedAt: now,
          nextAttemptAt: null,
          processingToken: null,
          processingUntil: null,
          errorCode: classified.category,
          errorClass: classified.errorClass === "retryable" ? "final" : classified.errorClass,
        },
      });
      this.logger.error(
        {
          deliveryId: delivery.id,
          reminderId: reminder.reminderId,
          channel: "EMAIL",
          status: "FAILED",
          attempt: attemptCount,
          errorClass: classified.errorClass,
        },
        "notification.delivery.failed",
      );
      return { outcome: "failed" };
    }
  }

  private async claim(deliveryId: string, now: Date): Promise<boolean> {
    const token = randomUUID();
    const result = await this.db.notificationDelivery.updateMany({
      where: {
        id: deliveryId,
        OR: [
          { status: { in: ["PENDING", "RETRYABLE"] } },
          { status: "PROCESSING", processingUntil: { lt: now } },
        ],
      },
      data: {
        status: "PROCESSING",
        processingToken: token,
        processingUntil: new Date(now.getTime() + this.policy.leaseSeconds * 1000),
        attemptCount: { increment: 1 },
      },
    });
    return result.count === 1;
  }

  private async loadReminder(sourceId: string): Promise<ReminderSourceState | null> {
    const row = await this.db.workspaceObject.findFirst({
      where: { id: sourceId, kind: "REMINDER" },
      include: { reminder: true },
    });
    if (!row?.reminder) {
      return null;
    }
    return {
      reminderId: row.id,
      ownerUserId: row.personalOwnerUserId,
      status: row.reminder.status,
      scheduledAt: row.reminder.scheduledAt,
      timezone: row.reminder.timezone,
      title: row.reminder.title,
      description: row.reminder.description,
      archivedAt: row.archivedAt,
      deletedAt: row.deletedAt,
    };
  }

  private async deliverInApp(
    userId: string,
    reminder: ReminderSourceState,
    occurrenceKey: string,
    scheduledLabel: string,
  ): Promise<string> {
    const title = sanitizeUserText(reminder.title, 200);
    const body = sanitizeUserText(scheduledLabel, 400);
    try {
      const created = await this.db.userNotification.create({
        data: {
          userId,
          type: "REMINDER_DUE",
          sourceType: "WORKSPACE_REMINDER",
          sourceId: reminder.reminderId,
          occurrenceKey,
          title,
          body: body.length > 0 ? body : null,
          hrefPath: reminderHrefPath(),
        },
      });
      return created.id;
    } catch (error: unknown) {
      if (!isPrismaUniqueConflict(error)) {
        throw error;
      }
      const existing = await this.db.userNotification.findFirst({
        where: { userId, type: "REMINDER_DUE", occurrenceKey },
      });
      if (!existing) {
        throw error;
      }
      return existing.id;
    }
  }

  private async markDelivered(
    deliveryId: string,
    now: Date,
    extra: { userNotificationId?: string; providerMessageId?: string | null },
  ): Promise<void> {
    await this.db.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "DELIVERED",
        deliveredAt: now,
        nextAttemptAt: null,
        processingToken: null,
        processingUntil: null,
        errorCode: null,
        errorClass: null,
        userNotificationId: extra.userNotificationId,
        providerMessageId: extra.providerMessageId,
      },
    });
  }

  private async markSkipped(deliveryId: string, reason: string, now: Date): Promise<void> {
    await this.db.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "SKIPPED",
        skippedAt: now,
        nextAttemptAt: null,
        processingToken: null,
        processingUntil: null,
        errorCode: reason,
        errorClass: "final",
      },
    });
  }

  private async markReminderDelivered(reminderId: string, now: Date): Promise<void> {
    await this.db.workspaceReminder.updateMany({
      where: {
        objectId: reminderId,
        status: "PENDING",
        scheduledAt: { lte: now },
      },
      data: {
        status: "DELIVERED",
        deliveredAt: now,
      },
    });
  }
}
