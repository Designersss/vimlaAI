-- Phase 6.5: Notification Platform.
-- PostgreSQL is the source of truth for in-app notifications and delivery intent.
-- Redis/BullMQ is transport only. Recurring reminders, Web Push and SMS are out of scope.

ALTER TABLE "user_preference" ADD COLUMN "reminderInAppEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "user_preference" ADD COLUMN "reminderEmailEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "user_notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "occurrenceKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "hrefPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "user_notification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_notification_type_chk" CHECK ("type" IN ('REMINDER_DUE')),
    CONSTRAINT "user_notification_source_type_chk" CHECK ("sourceType" IN ('WORKSPACE_REMINDER')),
    CONSTRAINT "user_notification_href_chk" CHECK (
        "hrefPath" IS NULL OR (
            "hrefPath" LIKE '/work/%'
            AND POSITION('://' IN "hrefPath") = 0
            AND POSITION('//' IN "hrefPath") = 0
        )
    )
);

CREATE UNIQUE INDEX "user_notification_userId_type_occurrenceKey_key" ON "user_notification"("userId", "type", "occurrenceKey");
CREATE INDEX "user_notification_userId_createdAt_idx" ON "user_notification"("userId", "createdAt");
CREATE INDEX "user_notification_userId_readAt_idx" ON "user_notification"("userId", "readAt");

ALTER TABLE "user_notification"
    ADD CONSTRAINT "user_notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "notification_delivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notificationType" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "nextAttemptAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "processingToken" TEXT,
    "processingUntil" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "errorClass" TEXT,
    "userNotificationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_delivery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_delivery_channel_chk" CHECK ("channel" IN ('IN_APP', 'EMAIL')),
    CONSTRAINT "notification_delivery_status_chk" CHECK ("status" IN ('PENDING', 'PROCESSING', 'DELIVERED', 'RETRYABLE', 'FAILED', 'SKIPPED')),
    CONSTRAINT "notification_delivery_type_chk" CHECK ("notificationType" IN ('REMINDER_DUE')),
    CONSTRAINT "notification_delivery_source_type_chk" CHECK ("sourceType" IN ('WORKSPACE_REMINDER')),
    CONSTRAINT "notification_delivery_attempts_chk" CHECK ("attemptCount" >= 0)
);

CREATE UNIQUE INDEX "notification_delivery_sourceType_sourceId_occurrenceKey_channel_key"
    ON "notification_delivery"("sourceType", "sourceId", "occurrenceKey", "channel");
CREATE INDEX "notification_delivery_status_nextAttemptAt_idx" ON "notification_delivery"("status", "nextAttemptAt");
CREATE INDEX "notification_delivery_userId_createdAt_idx" ON "notification_delivery"("userId", "createdAt");
CREATE INDEX "notification_delivery_sourceType_sourceId_idx" ON "notification_delivery"("sourceType", "sourceId");

ALTER TABLE "notification_delivery"
    ADD CONSTRAINT "notification_delivery_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_delivery"
    ADD CONSTRAINT "notification_delivery_userNotificationId_fkey"
    FOREIGN KEY ("userNotificationId") REFERENCES "user_notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
