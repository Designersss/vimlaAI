CREATE TABLE "direct_message_mention" (
  "id" TEXT NOT NULL,
  "directMessageId" TEXT NOT NULL,
  "handleId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "targetId" TEXT,
  "canonicalHandle" TEXT NOT NULL,
  "startOffset" INTEGER NOT NULL,
  "endOffset" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "direct_message_mention_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "direct_message_mention_kind_check" CHECK ("kind" IN ('USER', 'SYSTEM_AGENT', 'AI_AUTO', 'AI_MODEL')),
  CONSTRAINT "direct_message_mention_range_check" CHECK ("startOffset" >= 0 AND "endOffset" > "startOffset"),
  CONSTRAINT "direct_message_mention_canonical_check" CHECK (
    "canonicalHandle" = lower("canonicalHandle")
    AND "canonicalHandle" ~ '^[a-z0-9][a-z0-9._-]*[a-z0-9]$'
  )
);

CREATE UNIQUE INDEX "direct_message_mention_message_range_key"
  ON "direct_message_mention"("directMessageId", "startOffset", "endOffset");
CREATE INDEX "direct_message_mention_message_start_idx"
  ON "direct_message_mention"("directMessageId", "startOffset");
CREATE INDEX "direct_message_mention_handle_idx"
  ON "direct_message_mention"("handleId");

ALTER TABLE "direct_message_mention"
  ADD CONSTRAINT "direct_message_mention_message_fkey"
  FOREIGN KEY ("directMessageId") REFERENCES "direct_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "direct_message_mention"
  ADD CONSTRAINT "direct_message_mention_handle_fkey"
  FOREIGN KEY ("handleId") REFERENCES "handle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
