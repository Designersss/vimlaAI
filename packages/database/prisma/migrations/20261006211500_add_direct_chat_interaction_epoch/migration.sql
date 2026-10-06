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
