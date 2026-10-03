-- MSG-02: make Direct Chat read state use the same stable tuple semantics as message ordering.
ALTER TABLE "direct_conversation_member"
  ADD COLUMN "lastReadMessageId" TEXT;

UPDATE "direct_conversation_member" AS member
SET "lastReadMessageId" = (
  SELECT message."id"
  FROM "direct_message" AS message
  WHERE
    message."conversationId" = member."conversationId"
    AND message."createdAt" <= member."lastReadMessageCreatedAt"
  ORDER BY message."createdAt" DESC, message."id" DESC
  LIMIT 1
)
WHERE member."lastReadMessageCreatedAt" IS NOT NULL;

UPDATE "direct_conversation_member"
SET "lastReadMessageCreatedAt" = NULL
WHERE
  "lastReadMessageCreatedAt" IS NOT NULL
  AND "lastReadMessageId" IS NULL;

ALTER TABLE "direct_conversation_member"
  ADD CONSTRAINT "direct_conversation_member_read_position_chk"
  CHECK (
    ("lastReadMessageCreatedAt" IS NULL AND "lastReadMessageId" IS NULL)
    OR
    ("lastReadMessageCreatedAt" IS NOT NULL AND "lastReadMessageId" IS NOT NULL)
  );

DROP INDEX IF EXISTS "direct_message_conversationId_createdAt_idx";
CREATE INDEX "direct_message_conversationId_createdAt_id_idx"
  ON "direct_message"("conversationId", "createdAt", "id");
