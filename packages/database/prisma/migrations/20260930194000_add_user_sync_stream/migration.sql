ALTER TABLE "durable_event"
  ADD COLUMN "changeKind" TEXT NOT NULL DEFAULT 'UPSERT_REF';

ALTER TABLE "durable_event_recipient"
  ADD COLUMN "position" BIGINT;

CREATE TABLE "user_sync_state" (
  "userId" TEXT NOT NULL,
  "lastPosition" BIGINT NOT NULL DEFAULT 0,
  "minRetainedPosition" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_sync_state_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "user_sync_state_userId_fkey"
    FOREIGN KEY ("userId")
    REFERENCES "user"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "user_sync_state_position_check"
    CHECK (
      "lastPosition" >= 0
      AND "minRetainedPosition" >= 0
      AND "minRetainedPosition" <= "lastPosition"
    )
);

WITH ranked AS (
  SELECT
    r."eventId",
    r."userId",
    ROW_NUMBER() OVER (
      PARTITION BY r."userId"
      ORDER BY e."sequence" ASC, r."eventId" ASC
    )::BIGINT AS "position"
  FROM "durable_event_recipient" AS r
  INNER JOIN "durable_event" AS e
    ON e."id" = r."eventId"
)
UPDATE "durable_event_recipient" AS r
SET "position" = ranked."position"
FROM ranked
WHERE
  r."eventId" = ranked."eventId"
  AND r."userId" = ranked."userId";

ALTER TABLE "durable_event_recipient"
  ALTER COLUMN "position" SET NOT NULL;

ALTER TABLE "durable_event_recipient"
  ADD CONSTRAINT "durable_event_recipient_position_check"
  CHECK ("position" > 0);

DROP INDEX "durable_event_recipient_userId_eventId_idx";

INSERT INTO "user_sync_state" (
  "userId",
  "lastPosition",
  "minRetainedPosition"
)
SELECT
  r."userId",
  MAX(r."position"),
  0
FROM "durable_event_recipient" AS r
GROUP BY r."userId";

ALTER TABLE "durable_event"
  ADD CONSTRAINT "durable_event_change_kind_check"
  CHECK ("changeKind" IN ('UPSERT_REF', 'TOMBSTONE'));

CREATE UNIQUE INDEX
  "durable_event_recipient_userId_position_key"
  ON "durable_event_recipient"("userId", "position");

