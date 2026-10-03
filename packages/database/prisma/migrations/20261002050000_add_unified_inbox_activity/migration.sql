-- MSG-02: one authoritative activity key for mixed communication-surface ordering.
-- Domain tables remain authorization/content truth; this column is ordering metadata only.

ALTER TABLE "communication_surface"
  ADD COLUMN "lastActivityAt" TIMESTAMP(3);

UPDATE "communication_surface" AS surface
SET "lastActivityAt" = COALESCE(
  (
    SELECT MAX(message."updatedAt")
    FROM "message" AS message
    WHERE message."conversationId" = surface."conversationId"
  ),
  conversation."createdAt"
)
FROM "conversation" AS conversation
WHERE
  surface."kind" = 'AI_THREAD'
  AND surface."conversationId" = conversation."id";

UPDATE "communication_surface" AS surface
SET "lastActivityAt" = COALESCE(
  (
    SELECT MAX(message."createdAt")
    FROM "direct_message" AS message
    WHERE message."conversationId" = surface."directConversationId"
  ),
  direct."createdAt"
)
FROM "direct_conversation" AS direct
WHERE
  surface."kind" = 'DIRECT'
  AND surface."directConversationId" = direct."id";

UPDATE "communication_surface"
SET "lastActivityAt" = "createdAt"
WHERE "lastActivityAt" IS NULL;

ALTER TABLE "communication_surface"
  ALTER COLUMN "lastActivityAt" SET NOT NULL,
  ALTER COLUMN "lastActivityAt" SET DEFAULT CURRENT_TIMESTAMP;

DROP INDEX IF EXISTS "communication_surface_kind_status_updatedAt_idx";

CREATE INDEX "communication_surface_status_lastActivityAt_id_idx"
  ON "communication_surface"("status", "lastActivityAt", "id");

CREATE INDEX "message_conversationId_updatedAt_id_idx"
  ON "message"("conversationId", "updatedAt", "id");

CREATE OR REPLACE FUNCTION "vimla_create_ai_thread_communication_surface"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "communication_surface" (
    "id",
    "kind",
    "status",
    "lastActivityAt",
    "conversationId",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    gen_random_uuid(),
    'AI_THREAD',
    'ACTIVE',
    NEW."createdAt",
    NEW."id",
    NEW."createdAt",
    NEW."updatedAt"
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "vimla_create_direct_communication_surface"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "communication_surface" (
    "id",
    "kind",
    "status",
    "lastActivityAt",
    "directConversationId",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    gen_random_uuid(),
    'DIRECT',
    'ACTIVE',
    NEW."createdAt",
    NEW."id",
    NEW."createdAt",
    NEW."updatedAt"
  );
  RETURN NEW;
END;
$$;

CREATE FUNCTION "vimla_touch_ai_thread_surface_activity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "communication_surface"
  SET "lastActivityAt" = GREATEST(
    "lastActivityAt",
    NEW."createdAt",
    NEW."updatedAt"
  )
  WHERE
    "kind" = 'AI_THREAD'
    AND "conversationId" = NEW."conversationId";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "message_touch_communication_surface_activity"
AFTER INSERT OR UPDATE ON "message"
FOR EACH ROW
EXECUTE FUNCTION "vimla_touch_ai_thread_surface_activity"();

CREATE FUNCTION "vimla_touch_direct_surface_activity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "communication_surface"
  SET "lastActivityAt" = GREATEST(
    "lastActivityAt",
    NEW."createdAt",
    clock_timestamp() AT TIME ZONE 'UTC'
  )
  WHERE
    "kind" = 'DIRECT'
    AND "directConversationId" = NEW."conversationId";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "direct_message_touch_communication_surface_activity"
AFTER INSERT ON "direct_message"
FOR EACH ROW
EXECUTE FUNCTION "vimla_touch_direct_surface_activity"();
