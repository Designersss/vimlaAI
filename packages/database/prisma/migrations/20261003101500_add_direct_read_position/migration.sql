-- MSG-02: authoritative causal ordering for Direct Chat read state.
-- Message display timestamps remain metadata; read progress uses a server-assigned
-- per-conversation sequence that is serialized by locking the conversation row.

ALTER TABLE "direct_conversation"
  ADD COLUMN "lastMessageSequence" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "direct_message"
  ADD COLUMN "sequence" BIGINT;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "conversationId"
      ORDER BY "createdAt" ASC, "id" ASC
    )::BIGINT AS "sequence"
  FROM "direct_message"
)
UPDATE "direct_message" AS message
SET "sequence" = ranked."sequence"
FROM ranked
WHERE ranked."id" = message."id";

UPDATE "direct_conversation" AS conversation
SET
  "lastMessageSequence" = COALESCE(
    (
      SELECT MAX(message."sequence")
      FROM "direct_message" AS message
      WHERE message."conversationId" = conversation."id"
    ),
    0
  ),
  "lastMessageAt" = GREATEST(
    conversation."lastMessageAt",
    COALESCE(
      (
        SELECT MAX(message."createdAt")
        FROM "direct_message" AS message
        WHERE message."conversationId" = conversation."id"
      ),
      conversation."lastMessageAt"
    )
  );

ALTER TABLE "direct_message"
  ALTER COLUMN "sequence" SET NOT NULL,
  ALTER COLUMN "sequence" SET DEFAULT 0;

CREATE UNIQUE INDEX "direct_message_conversationId_sequence_key"
  ON "direct_message"("conversationId", "sequence");

DROP INDEX IF EXISTS "direct_message_conversationId_createdAt_idx";
CREATE INDEX "direct_message_conversationId_createdAt_id_idx"
  ON "direct_message"("conversationId", "createdAt", "id");

CREATE OR REPLACE FUNCTION "vimla_assign_direct_message_sequence"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "direct_conversation"
  SET
    "lastMessageSequence" = "lastMessageSequence" + 1,
    "lastMessageAt" = GREATEST("lastMessageAt", NEW."createdAt")
  WHERE "id" = NEW."conversationId"
  RETURNING "lastMessageSequence" INTO NEW."sequence";

  IF NEW."sequence" IS NULL THEN
    RAISE EXCEPTION 'Direct Chat conversation was not found'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "direct_message_assign_sequence"
BEFORE INSERT ON "direct_message"
FOR EACH ROW
EXECUTE FUNCTION "vimla_assign_direct_message_sequence"();

ALTER TABLE "direct_conversation_member"
  ADD COLUMN "lastReadMessageSequence" BIGINT;

UPDATE "direct_conversation_member" AS member
SET "lastReadMessageSequence" = (
  SELECT MAX(message."sequence")
  FROM "direct_message" AS message
  WHERE
    message."conversationId" = member."conversationId"
    AND member."lastReadMessageCreatedAt" IS NOT NULL
    AND message."createdAt" <= member."lastReadMessageCreatedAt"
)
WHERE member."lastReadMessageCreatedAt" IS NOT NULL;

ALTER TABLE "direct_conversation_member"
  DROP COLUMN "lastReadMessageCreatedAt";
