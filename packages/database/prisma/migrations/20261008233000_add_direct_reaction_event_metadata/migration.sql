-- MSG-03 reactions: opaque, signed E2EE source correlation; never plaintext.
-- Reactions share the Direct Double Ratchet envelope stream, sequence,
-- durable sync and sender-device idempotency but are NOT user-visible
-- conversation activity or unread human messages.
ALTER TABLE "direct_message"
  ADD COLUMN "reactionTargetTagB64" TEXT;

ALTER TABLE "direct_message"
  DROP CONSTRAINT "direct_message_kind_chk";

ALTER TABLE "direct_message"
  ADD CONSTRAINT "direct_message_kind_chk"
  CHECK ("kind" IN (
    'HUMAN', 'REACTION', 'OPERATOR_INVOKE',
    'OPERATOR_RESPONSE', 'OPERATOR_ACTION'
  ));

ALTER TABLE "direct_message"
  ADD CONSTRAINT "direct_message_reaction_target_chk"
  CHECK (
    ("kind" = 'REACTION'
      AND "contentCommitmentB64" IS NOT NULL
      AND "reactionTargetTagB64" IS NOT NULL
      AND "reactionTargetTagB64" ~ '^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=
    )
    OR ("kind" <> 'REACTION' AND "reactionTargetTagB64" IS NULL)
  );

CREATE INDEX "direct_message_conversationId_reactionTargetTagB64_sequence_idx"
  ON "direct_message"("conversationId", "reactionTargetTagB64", "sequence");

-- All encrypted envelopes must retain one causally consistent conversation
-- sequence, including controls, to preserve ratchet replay ordering.
-- Only ordinary message sends advance *visible* conversation activity.
CREATE OR REPLACE FUNCTION "vimla_assign_direct_message_sequence"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "direct_conversation"
  SET
    "lastMessageSequence" = "lastMessageSequence" + 1,
    "lastMessageAt" = CASE
      WHEN NEW."kind" = 'REACTION' THEN "lastMessageAt"
      ELSE GREATEST("lastMessageAt", NEW."createdAt")
    END,
    "updatedAt" = GREATEST(
      "updatedAt",
      clock_timestamp() AT TIME ZONE 'UTC'
    )
  WHERE "id" = NEW."conversationId"
  RETURNING "lastMessageSequence" INTO NEW."sequence";

  IF NEW."sequence" IS NULL THEN
    RAISE EXCEPTION 'Direct Chat conversation was not found'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

-- This trigger is also used by the unified inbox sort projection. A reaction
-- must not reorder an existing conversation ahead of new human activity.
CREATE OR REPLACE FUNCTION "vimla_touch_direct_surface_activity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."kind" = 'REACTION' THEN
    RETURN NEW;
  END IF;

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

    )
    OR ("kind" <> 'REACTION' AND "reactionTargetTagB64" IS NULL)
  );

CREATE INDEX "direct_message_conversationId_reactionTargetTagB64_sequence_idx"
  ON "direct_message"("conversationId", "reactionTargetTagB64", "sequence");

-- All encrypted envelopes must retain one causally consistent conversation
-- sequence, including controls, to preserve ratchet replay ordering.
-- Only ordinary message sends advance *visible* conversation activity.
CREATE OR REPLACE FUNCTION "vimla_assign_direct_message_sequence"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "direct_conversation"
  SET
    "lastMessageSequence" = "lastMessageSequence" + 1,
    "lastMessageAt" = CASE
      WHEN NEW."kind" = 'REACTION' THEN "lastMessageAt"
      ELSE GREATEST("lastMessageAt", NEW."createdAt")
    END,
    "updatedAt" = GREATEST(
      "updatedAt",
      clock_timestamp() AT TIME ZONE 'UTC'
    )
  WHERE "id" = NEW."conversationId"
  RETURNING "lastMessageSequence" INTO NEW."sequence";

  IF NEW."sequence" IS NULL THEN
    RAISE EXCEPTION 'Direct Chat conversation was not found'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

-- This trigger is also used by the unified inbox sort projection. A reaction
-- must not reorder an existing conversation ahead of new human activity.
CREATE OR REPLACE FUNCTION "vimla_touch_direct_surface_activity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."kind" = 'REACTION' THEN
    RETURN NEW;
  END IF;

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
