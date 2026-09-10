import type { PrismaClient } from "@vimla/database";
import { reminderOccurrenceKey } from "./occurrence-key.js";
import { isPastMaxLateness } from "./late-policy.js";
import { desiredReminderChannels, resolveReminderPreferences } from "./preferences.js";
import { isPrismaUniqueConflict } from "./prisma-errors.js";
import type { PlatformLogger } from "./logger.js";

export interface ReminderReconcilePolicy {
  maxLatenessMinutes: number;
  batchSize: number;
}

export interface ReminderReconcileCounters {
  checked: number;
  due: number;
  deliveryCreated: number;
  requeued: number;
  skipped: number;
  failed: number;
}

const EXECUTABLE_STATUSES = ["PENDING", "RETRYABLE"] as const;

export class ReminderReconciler {
  constructor(
    private readonly db: PrismaClient,
    private readonly policy: ReminderReconcilePolicy,
    private readonly enqueue: (deliveryId: string) => Promise<void>,
    private readonly logger: PlatformLogger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcile(): Promise<ReminderReconcileCounters> {
    const counters: ReminderReconcileCounters = {
      checked: 0,
      due: 0,
      deliveryCreated: 0,
      requeued: 0,
      skipped: 0,
      failed: 0,
    };
    const now = this.now();

    try {
      await this.createDueDeliveries(now, counters);
      await this.requeueExecutable(now, counters);
    } catch (error: unknown) {
      counters.failed += 1;
      this.logger.error(
        { err: error instanceof Error ? error.message : "unknown" },
        "reminder.reconcile.failed",
      );
      throw error;
    }

    this.logger.info(
      {
        checked: counters.checked,
        due: counters.due,
        deliveryCreated: counters.deliveryCreated,
        requeued: counters.requeued,
        skipped: counters.skipped,
        failed: counters.failed,
      },
      "reminder.reconcile.completed",
    );
    return counters;
  }

  private async createDueDeliveries(now: Date, counters: ReminderReconcileCounters): Promise<void> {
    const due = await this.db.workspaceReminder.findMany({
      where: {
        status: "PENDING",
        scheduledAt: { lte: now },
        object: {
          is: {
            kind: "REMINDER",
            deletedAt: null,
            archivedAt: null,
            scopeType: "PERSONAL",
          },
        },
      },
      include: {
        object: true,
      },
      orderBy: [{ scheduledAt: "asc" }, { objectId: "asc" }],
      take: this.policy.batchSize,
    });

    counters.checked += due.length;
    counters.due += due.length;

    const ownerIds = [...new Set(due.map((row) => row.object.personalOwnerUserId))];
    const users = await this.db.user.findMany({
      where: { id: { in: ownerIds } },
      include: { preference: true },
    });
    const userById = new Map(users.map((user) => [user.id, user]));

    for (const reminder of due) {
      const ownerId = reminder.object.personalOwnerUserId;
      const user = userById.get(ownerId);
      if (!user) {
        counters.skipped += 1;
        continue;
      }
      const occurrenceKey = reminderOccurrenceKey(reminder.objectId, reminder.scheduledAt);
      const expired = isPastMaxLateness({
        scheduledFor: reminder.scheduledAt,
        now,
        maxLatenessMinutes: this.policy.maxLatenessMinutes,
      });
      if (expired) {
        await this.db.workspaceReminder.updateMany({
          where: { objectId: reminder.objectId, status: "PENDING" },
          data: { status: "FAILED" },
        });
      }
      const channels = expired
        ? (["IN_APP", "EMAIL"] as const)
        : desiredReminderChannels(resolveReminderPreferences(user.preference));

      if (channels.length === 0) {
        counters.skipped += 1;
        continue;
      }

      for (const channel of channels) {
        const created = await this.ensureDelivery({
          userId: ownerId,
          sourceId: reminder.objectId,
          occurrenceKey,
          channel,
          scheduledFor: reminder.scheduledAt,
          status: expired ? "SKIPPED" : "PENDING",
          errorCode: expired ? "expired" : null,
          errorClass: expired ? "final" : null,
          skippedAt: expired ? now : null,
        });
        if (created) {
          counters.deliveryCreated += 1;
          if (expired) {
            counters.skipped += 1;
          }
        } else if (expired) {
          counters.skipped += 1;
        }
      }
    }
  }

  private async ensureDelivery(input: {
    userId: string;
    sourceId: string;
    occurrenceKey: string;
    channel: "IN_APP" | "EMAIL";
    scheduledFor: Date;
    status: "PENDING" | "SKIPPED";
    errorCode: string | null;
    errorClass: string | null;
    skippedAt: Date | null;
  }): Promise<boolean> {
    try {
      await this.db.notificationDelivery.create({
        data: {
          userId: input.userId,
          notificationType: "REMINDER_DUE",
          sourceType: "WORKSPACE_REMINDER",
          sourceId: input.sourceId,
          occurrenceKey: input.occurrenceKey,
          channel: input.channel,
          status: input.status,
          scheduledFor: input.scheduledFor,
          nextAttemptAt: input.status === "PENDING" ? input.scheduledFor : null,
          errorCode: input.errorCode,
          errorClass: input.errorClass,
          skippedAt: input.skippedAt,
        },
      });
      return true;
    } catch (error: unknown) {
      if (isPrismaUniqueConflict(error)) {
        return false;
      }
      throw error;
    }
  }

  private async requeueExecutable(now: Date, counters: ReminderReconcileCounters): Promise<void> {
    const expiredLeases = await this.db.notificationDelivery.updateMany({
      where: {
        status: "PROCESSING",
        processingUntil: { lt: now },
      },
      data: {
        status: "RETRYABLE",
        nextAttemptAt: now,
        processingToken: null,
        processingUntil: null,
      },
    });
    if (expiredLeases.count > 0) {
      this.logger.warn({ recovered: expiredLeases.count }, "reminder.delivery.lease_recovered");
    }

    const executable = await this.db.notificationDelivery.findMany({
      where: {
        status: { in: [...EXECUTABLE_STATUSES] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      select: { id: true },
      orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
      take: this.policy.batchSize,
    });

    for (const row of executable) {
      try {
        await this.enqueue(row.id);
        counters.requeued += 1;
      } catch (error: unknown) {
        counters.failed += 1;
        this.logger.error(
          { deliveryId: row.id, err: error instanceof Error ? error.message : "unknown" },
          "reminder.delivery.enqueue_failed",
        );
      }
    }
  }
}
