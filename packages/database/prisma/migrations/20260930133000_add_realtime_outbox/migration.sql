CREATE TABLE "durable_event" (
  "sequence" BIGSERIAL NOT NULL,
  "id" UUID NOT NULL,
  "protocolVersion" INTEGER NOT NULL,
  "eventType" TEXT NOT NULL,
  "durability" TEXT NOT NULL,
  "scopeKind" TEXT NOT NULL,
  "scopeId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "durable_event_pkey" PRIMARY KEY ("sequence"),
  CONSTRAINT "durable_event_id_key" UNIQUE ("id"),
  CONSTRAINT "durable_event_protocol_version_check"
    CHECK ("protocolVersion" >= 1),
  CONSTRAINT "durable_event_event_type_check"
    CHECK ("eventType" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT "durable_event_durability_check"
    CHECK ("durability" = 'DURABLE_HINT'),
  CONSTRAINT "durable_event_scope_kind_check"
    CHECK ("scopeKind" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT "durable_event_scope_id_check"
    CHECK (length("scopeId") BETWEEN 1 AND 128),
  CONSTRAINT "durable_event_payload_object_check"
    CHECK (jsonb_typeof("payload") = 'object'),
  CONSTRAINT "durable_event_payload_size_check"
    CHECK (pg_column_size("payload") <= 8192)
);

CREATE TABLE "durable_event_recipient" (
  "eventId" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "durable_event_recipient_pkey"
    PRIMARY KEY ("eventId", "userId"),
  CONSTRAINT "durable_event_recipient_eventId_fkey"
    FOREIGN KEY ("eventId")
    REFERENCES "durable_event"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "durable_event_recipient_userId_fkey"
    FOREIGN KEY ("userId")
    REFERENCES "user"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE TABLE "realtime_outbox" (
  "eventId" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "processingToken" UUID,
  "processingUntil" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "compactAfter" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "realtime_outbox_pkey" PRIMARY KEY ("eventId"),
  CONSTRAINT "realtime_outbox_eventId_fkey"
    FOREIGN KEY ("eventId")
    REFERENCES "durable_event"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "realtime_outbox_status_check"
    CHECK ("status" IN ('PENDING', 'PROCESSING', 'PUBLISHED')),
  CONSTRAINT "realtime_outbox_attempt_count_check"
    CHECK ("attemptCount" >= 0),
  CONSTRAINT "realtime_outbox_error_code_check"
    CHECK (
      "lastErrorCode" IS NULL
      OR "lastErrorCode" ~ '^[a-z][a-z0-9_]{0,63}$'
    ),
  CONSTRAINT "realtime_outbox_state_check"
    CHECK (
      (
        "status" = 'PENDING'
        AND "processingToken" IS NULL
        AND "processingUntil" IS NULL
        AND "publishedAt" IS NULL
        AND "compactAfter" IS NULL
        AND "nextAttemptAt" IS NOT NULL
      )
      OR
      (
        "status" = 'PROCESSING'
        AND "processingToken" IS NOT NULL
        AND "processingUntil" IS NOT NULL
        AND "publishedAt" IS NULL
        AND "compactAfter" IS NULL
        AND "nextAttemptAt" IS NULL
      )
      OR
      (
        "status" = 'PUBLISHED'
        AND "processingToken" IS NULL
        AND "processingUntil" IS NULL
        AND "publishedAt" IS NOT NULL
        AND "compactAfter" IS NOT NULL
        AND "nextAttemptAt" IS NULL
      )
    )
);

CREATE INDEX "durable_event_scopeKind_scopeId_sequence_idx"
  ON "durable_event"("scopeKind", "scopeId", "sequence");

CREATE INDEX "durable_event_occurredAt_sequence_idx"
  ON "durable_event"("occurredAt", "sequence");

CREATE INDEX "durable_event_recipient_userId_eventId_idx"
  ON "durable_event_recipient"("userId", "eventId");

CREATE INDEX "realtime_outbox_status_nextAttemptAt_eventId_idx"
  ON "realtime_outbox"("status", "nextAttemptAt", "eventId");

CREATE INDEX "realtime_outbox_status_processingUntil_eventId_idx"
  ON "realtime_outbox"("status", "processingUntil", "eventId");

CREATE INDEX "realtime_outbox_compactAfter_idx"
  ON "realtime_outbox"("compactAfter");
