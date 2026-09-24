ALTER TABLE "conversation"
  ADD COLUMN "defaultTargetKind" TEXT,
  ADD COLUMN "defaultTargetModelId" TEXT;

ALTER TABLE "conversation"
  ADD CONSTRAINT "conversation_defaultTargetModelId_fkey"
  FOREIGN KEY ("defaultTargetModelId") REFERENCES "ai_model"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "conversation_defaultTargetModelId_idx"
  ON "conversation"("defaultTargetModelId");

ALTER TABLE "conversation"
  ADD CONSTRAINT "conversation_default_target_check" CHECK (
    (
      "defaultTargetKind" IS NULL
      AND "defaultTargetModelId" IS NULL
    )
    OR (
      "kind"='CHAT'
      AND "defaultTargetKind"='AI_AUTO'
      AND "defaultTargetModelId" IS NULL
    )
    OR (
      "kind"='CHAT'
      AND "defaultTargetKind"='AI_MODEL'
      AND "defaultTargetModelId" IS NOT NULL
    )
  );
