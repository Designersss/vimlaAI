CREATE TABLE "message_mention" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "handleId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "targetId" TEXT,
  "canonicalHandle" TEXT NOT NULL,
  "startOffset" INTEGER NOT NULL,
  "endOffset" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "message_mention_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "message_mention_kind_check" CHECK ("kind" IN ('USER', 'SYSTEM_AGENT', 'AI_AUTO', 'AI_MODEL')),
  CONSTRAINT "message_mention_range_check" CHECK ("startOffset" >= 0 AND "endOffset" > "startOffset"),
  CONSTRAINT "message_mention_canonical_check" CHECK (
    "canonicalHandle" = lower("canonicalHandle")
    AND "canonicalHandle" ~ '^[a-z0-9][a-z0-9._-]*[a-z0-9]$'
  )
);

CREATE UNIQUE INDEX "message_mention_messageId_startOffset_endOffset_key"
  ON "message_mention"("messageId", "startOffset", "endOffset");
CREATE INDEX "message_mention_messageId_startOffset_idx"
  ON "message_mention"("messageId", "startOffset");
CREATE INDEX "message_mention_handleId_idx"
  ON "message_mention"("handleId");

ALTER TABLE "message_mention"
  ADD CONSTRAINT "message_mention_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "message_mention"
  ADD CONSTRAINT "message_mention_handleId_fkey"
  FOREIGN KEY ("handleId") REFERENCES "handle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
