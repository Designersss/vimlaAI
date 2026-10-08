ALTER TABLE "direct_conversation"
ADD COLUMN "interactionEpoch" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "direct_message"
ADD COLUMN "interactionEpoch" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "direct_conversation"
ADD CONSTRAINT "direct_conversation_interaction_epoch_valid"
CHECK ("interactionEpoch" >= 0 AND "interactionEpoch" <= 2000000000);

ALTER TABLE "direct_message"
ADD CONSTRAINT "direct_message_interaction_epoch_valid"
CHECK ("interactionEpoch" >= 0 AND "interactionEpoch" <= 2000000000);


ALTER TABLE "operator_run"
ADD COLUMN "directInteractionEpoch" INTEGER;

ALTER TABLE "context_snapshot"
ADD COLUMN "directInteractionEpoch" INTEGER;

ALTER TABLE "operator_run"
ADD CONSTRAINT "operator_run_direct_interaction_epoch_valid"
CHECK (
  "directInteractionEpoch" IS NULL OR
  ("directInteractionEpoch" >= 0 AND "directInteractionEpoch" <= 2000000000)
);

ALTER TABLE "context_snapshot"
ADD CONSTRAINT "context_snapshot_direct_interaction_epoch_valid"
CHECK (
  "directInteractionEpoch" IS NULL OR
  ("directInteractionEpoch" >= 0 AND "directInteractionEpoch" <= 2000000000)
);
