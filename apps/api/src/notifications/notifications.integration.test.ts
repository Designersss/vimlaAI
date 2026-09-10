import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { loadApiConfig } from "@vimla/config/server";
import { createPrismaClient, type PrismaClient } from "@vimla/database";
import {
  createNotificationService,
  DELIVER_JOB_NAME,
  deliveryJobId,
  memoryNotificationInbox,
  NotificationDeliveryError,
  NotificationDeliveryProcessor,
  NOTIFICATIONS_QUEUE_NAME,
  ReminderReconciler,
  silentPlatformLogger,
} from "@vimla/notifications";
import { createVimlaApiApp } from "../create-app.js";
import { registerVerifiedUser } from "../test/identity-helpers.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const origin = "http://localhost:3000";

describe("notification platform", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let queue: Queue;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "test";
    process.env.LOG_LEVEL = "error";
    process.env.API_HOST = "127.0.0.1";
    process.env.API_PORT = "3001";
    process.env.WEB_ORIGIN = origin;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET ?? "local-dev-only-change-me-use-32-chars-min";
    process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
    process.env.EMAIL_PROVIDER = "memory";

    const config = loadApiConfig(process.env);
    app = await createVimlaApiApp(config, { quiet: true });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = createPrismaClient(testDatabaseUrl);
    redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
    queue = new Queue(NOTIFICATIONS_QUEUE_NAME, { connection: redis.duplicate() });
  });

  afterAll(async () => {
    await queue.close();
    await redis.quit();
    await prisma.$disconnect();
    if (app) {
      await app.close();
    }
  });

  it("creates due deliveries once, including under parallel reconciliation", async () => {
    const user = await registerVerifiedUser(app, "notify-due");
    await confirmTimezone(app, user.cookies);
    const reminder = await createDueReminder(app, user.cookies, "Due once");
    const enqueued: string[] = [];
    const reconciler = makeReconciler(prisma, async (id) => {
      enqueued.push(id);
    });

    await Promise.all([reconciler.reconcile(), reconciler.reconcile(), reconciler.reconcile()]);
    const deliveries = await prisma.notificationDelivery.findMany({
      where: { sourceId: reminder.id },
    });
    expect(deliveries.filter((row) => row.channel === "IN_APP")).toHaveLength(1);
    expect(deliveries.filter((row) => row.channel === "EMAIL")).toHaveLength(0);
    const second = await reconciler.reconcile();
    expect(second.deliveryCreated).toBe(0);
    expect(enqueued.length).toBeGreaterThan(0);
  });

  it("requeues pending DB deliveries when the BullMQ job is missing and skips DELIVERED", async () => {
    const user = await registerVerifiedUser(app, "notify-requeue");
    await confirmTimezone(app, user.cookies);
    const reminder = await createDueReminder(app, user.cookies, "Requeue me");
    const reconciler = makeReconciler(prisma, async (deliveryId) => {
      await queue.add(DELIVER_JOB_NAME, { deliveryId }, { jobId: deliveryJobId(deliveryId), removeOnComplete: true, removeOnFail: true });
    });
    await reconciler.reconcile();
    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { sourceId: reminder.id, channel: "IN_APP" },
    });
    const job = await queue.getJob(deliveryJobId(delivery.id));
    await job?.remove();
    expect(await queue.getJob(deliveryJobId(delivery.id))).toBeUndefined();

    await reconciler.reconcile();
    expect(await queue.getJob(deliveryJobId(delivery.id))).toBeTruthy();

    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: "DELIVERED", deliveredAt: new Date(), nextAttemptAt: null },
    });
    await (await queue.getJob(deliveryJobId(delivery.id)))?.remove();
    const before = await queue.getJob(deliveryJobId(delivery.id));
    expect(before).toBeUndefined();
    await reconciler.reconcile();
    expect(await queue.getJob(deliveryJobId(delivery.id))).toBeUndefined();
  });

  it("skips cancel and reschedule, then delivers the new occurrence", async () => {
    const user = await registerVerifiedUser(app, "notify-reschedule");
    await confirmTimezone(app, user.cookies);
    const reminder = await createDueReminder(app, user.cookies, "Move me");
    const processor = makeProcessor(prisma);
    const reconciler = makeReconciler(prisma, async () => undefined);
    await reconciler.reconcile();
    const oldDelivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { sourceId: reminder.id, channel: "IN_APP" },
    });

    const later = new Date(Date.now() + 60 * 60_000).toISOString();
    const moved = await app.inject({
      method: "PATCH",
      url: `/v1/workspace/reminders/${reminder.id}`,
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { scheduledAt: later },
    });
    expect(moved.statusCode).toBe(200);

    const stale = await processor.process(oldDelivery.id);
    expect(stale.outcome).toContain("skipped:rescheduled");
    expect(await prisma.userNotification.count({ where: { userId: user.id } })).toBe(0);

    const canceled = await createDueReminder(app, user.cookies, "Cancel me");
    await reconciler.reconcile();
    const cancelDelivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { sourceId: canceled.id, channel: "IN_APP" },
    });
    await app.inject({
      method: "PATCH",
      url: `/v1/workspace/reminders/${canceled.id}`,
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { status: "CANCELED" },
    });
    const skippedCancel = await processor.process(cancelDelivery.id);
    expect(skippedCancel.outcome).toContain("skipped:canceled");

    await prisma.workspaceReminder.update({
      where: { objectId: reminder.id },
      data: { scheduledAt: new Date(Date.now() - 1_000), status: "PENDING" },
    });
    await reconciler.reconcile();
    const nextDelivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { sourceId: reminder.id, channel: "IN_APP", status: "PENDING" },
    });
    const delivered = await processor.process(nextDelivery.id);
    expect(delivered.outcome).toBe("delivered");
    expect(await prisma.userNotification.count({ where: { userId: user.id, sourceId: reminder.id } })).toBe(1);
    await processor.process(nextDelivery.id);
    expect(await prisma.userNotification.count({ where: { userId: user.id, sourceId: reminder.id } })).toBe(1);
  });

  it("respects email preference, verified recipient and retry classification", async () => {
    const user = await registerVerifiedUser(app, "notify-email");
    await confirmTimezone(app, user.cookies);
    await app.inject({
      method: "PATCH",
      url: "/v1/notification-preferences",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { reminderEmailEnabled: true },
    });
    const reminder = await createDueReminder(app, user.cookies, "Email me", "America/New_York");
    const reconciler = makeReconciler(prisma, async () => undefined);
    await reconciler.reconcile();
    const emailDelivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { sourceId: reminder.id, channel: "EMAIL" },
    });
    memoryNotificationInbox.clear();
    const processor = makeProcessor(prisma);
    const sent = await processor.process(emailDelivery.id);
    expect(sent.outcome).toBe("delivered");
    const mail = memoryNotificationInbox.latestMatching({ channel: "email", to: user.email });
    expect(mail?.templateId).toBe("reminderDue");

    const disabled = await createDueReminder(app, user.cookies, "No email");
    await app.inject({
      method: "PATCH",
      url: "/v1/notification-preferences",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { reminderEmailEnabled: false },
    });
    await reconciler.reconcile();
    expect(
      await prisma.notificationDelivery.count({ where: { sourceId: disabled.id, channel: "EMAIL" } }),
    ).toBe(0);

    const retryable = await prisma.notificationDelivery.create({
      data: {
        userId: user.id,
        notificationType: "REMINDER_DUE",
        sourceType: "WORKSPACE_REMINDER",
        sourceId: reminder.id,
        occurrenceKey: `reminder:${reminder.id}:retry`,
        channel: "EMAIL",
        status: "PENDING",
        scheduledFor: new Date(),
        nextAttemptAt: new Date(),
      },
    });
    const failing = new NotificationDeliveryProcessor(
      prisma,
      processorPolicy(),
      async () => {
        throw new NotificationDeliveryError("network", "SMTP network failure");
      },
      silentPlatformLogger,
    );
    const retryResult = await failing.process(retryable.id);
    expect(retryResult.outcome).toBe("retryable");
    const retried = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: retryable.id } });
    expect(retried.status).toBe("RETRYABLE");
    expect(retried.nextAttemptAt).toBeTruthy();

    const permanent = await prisma.notificationDelivery.create({
      data: {
        userId: user.id,
        notificationType: "REMINDER_DUE",
        sourceType: "WORKSPACE_REMINDER",
        sourceId: reminder.id,
        occurrenceKey: `reminder:${reminder.id}:perm`,
        channel: "EMAIL",
        status: "PENDING",
        scheduledFor: new Date(),
        nextAttemptAt: new Date(),
      },
    });
    const rejecting = new NotificationDeliveryProcessor(
      prisma,
      processorPolicy(),
      async () => {
        throw new NotificationDeliveryError("rejected", "SMTP rejected the message");
      },
      silentPlatformLogger,
    );
    expect((await rejecting.process(permanent.id)).outcome).toBe("failed");
    expect((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: permanent.id } })).status).toBe(
      "FAILED",
    );
  });

  it("enforces IDOR, deterministic pagination and idempotent read updates", async () => {
    const owner = await registerVerifiedUser(app, "notify-idor-a");
    const stranger = await registerVerifiedUser(app, "notify-idor-b");
    await confirmTimezone(app, owner.cookies);
    const reminder = await createDueReminder(app, owner.cookies, "Private notice");
    const reconciler = makeReconciler(prisma, async () => undefined);
    await reconciler.reconcile();
    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { sourceId: reminder.id, channel: "IN_APP" },
    });
    await makeProcessor(prisma).process(delivery.id);

    const extraReminder = await createDueReminder(app, owner.cookies, "Second notice");
    await reconciler.reconcile();
    const extraDelivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { sourceId: extraReminder.id, channel: "IN_APP" },
    });
    await makeProcessor(prisma).process(extraDelivery.id);

    const list = await app.inject({
      method: "GET",
      url: "/v1/notifications?limit=1",
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(list.statusCode).toBe(200);
    const firstPage = list.json() as { items: Array<{ id: string; title: string }>; nextCursor: string | null };
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toBeTruthy();
    const notificationId = firstPage.items[0]?.id as string;

    const stolen = await app.inject({
      method: "GET",
      url: "/v1/notifications",
      headers: { origin },
      cookies: stranger.cookies,
    });
    expect(stolen.json().items).toEqual([]);
    const stolenRead = await app.inject({
      method: "PATCH",
      url: `/v1/notifications/${notificationId}/read`,
      headers: jsonHeaders(),
      cookies: stranger.cookies,
    });
    expect(stolenRead.statusCode).toBe(404);

    const readOnce = await app.inject({
      method: "PATCH",
      url: `/v1/notifications/${notificationId}/read`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
    });
    const readTwice = await app.inject({
      method: "PATCH",
      url: `/v1/notifications/${notificationId}/read`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
    });
    expect(readOnce.statusCode).toBe(200);
    expect(readTwice.statusCode).toBe(200);
    expect(readTwice.json().readAt).toBe(readOnce.json().readAt);

    await prisma.userNotification.create({
      data: {
        userId: stranger.id,
        type: "REMINDER_DUE",
        sourceType: "WORKSPACE_REMINDER",
        sourceId: reminder.id,
        occurrenceKey: `reminder:stranger:${Date.now()}`,
        title: "Stranger only",
        hrefPath: "/work/reminders",
      },
    });
    await app.inject({
      method: "POST",
      url: "/v1/notifications/read-all",
      headers: jsonHeaders(),
      cookies: owner.cookies,
    });
    const strangerUnread = await app.inject({
      method: "GET",
      url: "/v1/notifications/unread-count",
      headers: { origin },
      cookies: stranger.cookies,
    });
    expect(strangerUnread.json()).toEqual({ count: 1 });

    const page2 = await app.inject({
      method: "GET",
      url: `/v1/notifications?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(page2.statusCode).toBe(200);
    expect(page2.json().items).toHaveLength(1);
    expect(page2.json().items[0]?.id).not.toBe(notificationId);

    await prisma.workspaceObject.update({
      where: { id: reminder.id },
      data: { deletedAt: new Date() },
    });
    const afterDelete = await app.inject({
      method: "GET",
      url: "/v1/notifications",
      headers: { origin },
      cookies: owner.cookies,
    });
    const remaining = (afterDelete.json().items as Array<{ sourceAvailable: boolean; hrefPath: string | null }>).find(
      (item) => item.hrefPath === "/work/reminders",
    );
    expect(remaining?.sourceAvailable).toBe(false);
  });

  it("skips archived sources and formats timezone-specific reminder times", async () => {
    const user = await registerVerifiedUser(app, "notify-tz");
    await confirmTimezone(app, user.cookies, "Europe/Amsterdam");
    const reminder = await createDueReminder(app, user.cookies, "DST reminder", "Europe/Amsterdam");
    await app.inject({
      method: "PATCH",
      url: `/v1/workspace/reminders/${reminder.id}`,
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { archived: true },
    });
    const reconciler = makeReconciler(prisma, async () => undefined);
    await reconciler.reconcile();
    expect(await prisma.notificationDelivery.count({ where: { sourceId: reminder.id } })).toBe(0);

    const live = await createDueReminder(app, user.cookies, "Amsterdam live", "Europe/Amsterdam");
    await reconciler.reconcile();
    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { sourceId: live.id, channel: "IN_APP" },
    });
    await makeProcessor(prisma).process(delivery.id);
    const inbox = await app.inject({
      method: "GET",
      url: "/v1/notifications",
      headers: { origin },
      cookies: user.cookies,
    });
    const amsterdamItem = (inbox.json().items as Array<{ title: string; body: string | null }>).find(
      (item) => item.title === "Amsterdam live",
    );
    expect(amsterdamItem?.body).toBeTruthy();

    const doomed = await createDueReminder(app, user.cookies, "Delete before send", "Europe/Amsterdam");
    await reconciler.reconcile();
    const doomedDelivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { sourceId: doomed.id, channel: "IN_APP" },
    });
    await app.inject({
      method: "DELETE",
      url: `/v1/workspace/reminders/${doomed.id}`,
      headers: jsonHeaders(),
      cookies: user.cookies,
    });
    const skippedDeleted = await makeProcessor(prisma).process(doomedDelivery.id);
    expect(skippedDeleted.outcome).toContain("skipped:deleted");
    expect(await prisma.userNotification.count({ where: { userId: user.id, sourceId: doomed.id } })).toBe(0);
  });
});

function jsonHeaders(): Record<string, string> {
  return { origin, "content-type": "application/json" };
}

async function confirmTimezone(
  app: NestFastifyApplication,
  cookies: Record<string, string>,
  timezone = "Europe/Moscow",
): Promise<void> {
  const response = await app.inject({
    method: "PATCH",
    url: "/v1/me/preferences",
    headers: jsonHeaders(),
    cookies,
    payload: { timezone },
  });
  expect(response.statusCode).toBe(200);
}

async function createDueReminder(
  app: NestFastifyApplication,
  cookies: Record<string, string>,
  title: string,
  timezone = "Europe/Moscow",
): Promise<{ id: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/workspace/reminders",
    headers: jsonHeaders(),
    cookies,
    payload: {
      title,
      scheduledAt: new Date(Date.now() - 5_000).toISOString(),
      timezone,
    },
  });
  expect(response.statusCode).toBe(201);
  return { id: response.json().id as string };
}

function makeReconciler(prisma: PrismaClient, enqueue: (deliveryId: string) => Promise<void>): ReminderReconciler {
  return new ReminderReconciler(prisma, { maxLatenessMinutes: 1440, batchSize: 100 }, enqueue, silentPlatformLogger);
}

function processorPolicy() {
  return {
    maxLatenessMinutes: 1440,
    maxAttempts: 6,
    backoffBaseMs: 1,
    backoffCapMs: 10,
    leaseSeconds: 30,
    defaultLocale: "ru" as const,
    webOrigin: origin,
  };
}

function makeProcessor(prisma: PrismaClient): NotificationDeliveryProcessor {
  const service = createNotificationService({
    appEnv: "test",
    secret: "test-notification-secret-value-32ch",
    defaultLocale: "ru",
    email: { kind: "memory" },
    sms: { kind: "memory" },
  });
  return new NotificationDeliveryProcessor(
    prisma,
    processorPolicy(),
    (input) =>
      service.sendEmailOnce({
        to: input.to,
        templateId: "reminderDue",
        locale: input.locale,
        notificationId: input.notificationId,
        userId: input.userId,
        reminderTitle: input.reminderTitle,
        scheduledLabel: input.scheduledLabel,
        openUrl: input.openUrl,
        consumeBudget: false,
      }),
    silentPlatformLogger,
  );
}
