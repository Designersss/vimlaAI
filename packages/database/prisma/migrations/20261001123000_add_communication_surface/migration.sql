-- MSG-01: stable communication-surface identity for current communication domains.
-- Surface is routing/context identity only; domain tables remain authorization authority.

CREATE TABLE "communication_surface" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "conversationId" TEXT,
    "directConversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_surface_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "communication_surface_id_non_nil_chk"
      CHECK ("id" <> '00000000-0000-0000-0000-000000000000'::UUID),
    CONSTRAINT "communication_surface_id_rfc_chk"
      CHECK ("id"::TEXT ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    CONSTRAINT "communication_surface_kind_chk"
      CHECK ("kind" IN ('AI_THREAD', 'DIRECT')),
    CONSTRAINT "communication_surface_status_chk"
      CHECK ("status" IN ('ACTIVE')),
    CONSTRAINT "communication_surface_binding_chk"
      CHECK (
        (
          "kind" = 'AI_THREAD'
          AND "conversationId" IS NOT NULL
          AND "directConversationId" IS NULL
        )
        OR
        (
          "kind" = 'DIRECT'
          AND "conversationId" IS NULL
          AND "directConversationId" IS NOT NULL
        )
      )
);

CREATE UNIQUE INDEX "communication_surface_conversationId_key"
  ON "communication_surface"("conversationId");
CREATE UNIQUE INDEX "communication_surface_directConversationId_key"
  ON "communication_surface"("directConversationId");
CREATE INDEX "communication_surface_kind_status_updatedAt_idx"
  ON "communication_surface"("kind", "status", "updatedAt");

ALTER TABLE "communication_surface"
  ADD CONSTRAINT "communication_surface_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "conversation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "communication_surface"
  ADD CONSTRAINT "communication_surface_directConversationId_fkey"
  FOREIGN KEY ("directConversationId") REFERENCES "direct_conversation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION "vimla_communication_surface_binding_immutable"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $surface_binding$
BEGIN
  IF
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."conversationId" IS DISTINCT FROM OLD."conversationId"
    OR NEW."directConversationId" IS DISTINCT FROM OLD."directConversationId"
  THEN
    RAISE EXCEPTION 'Communication surface identity and domain binding are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$surface_binding$;

CREATE TRIGGER "communication_surface_binding_immutable"
BEFORE UPDATE OF "id", "kind", "conversationId", "directConversationId"
ON "communication_surface"
FOR EACH ROW
EXECUTE FUNCTION "vimla_communication_surface_binding_immutable"();

CREATE FUNCTION "vimla_communication_surface_delete_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $surface_delete$
BEGIN
  IF
    OLD."conversationId" IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM "conversation"
      WHERE "id" = OLD."conversationId"
    )
  THEN
    RAISE EXCEPTION 'Cannot delete a communication surface while its AI thread exists'
      USING ERRCODE = '23503';
  END IF;

  IF
    OLD."directConversationId" IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM "direct_conversation"
      WHERE "id" = OLD."directConversationId"
    )
  THEN
    RAISE EXCEPTION 'Cannot delete a communication surface while its Direct Chat exists'
      USING ERRCODE = '23503';
  END IF;

  RETURN OLD;
END;
$surface_delete$;

CREATE TRIGGER "communication_surface_delete_guard"
BEFORE DELETE ON "communication_surface"
FOR EACH ROW
EXECUTE FUNCTION "vimla_communication_surface_delete_guard"();

-- Existing development rows are assigned independent stable surface identities.
-- There is no released-client/data compatibility requirement, but making this
-- migration self-contained also keeps local/test databases easy to upgrade.
INSERT INTO "communication_surface" (
  "id",
  "kind",
  "status",
  "conversationId",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  'AI_THREAD',
  'ACTIVE',
  "id",
  "createdAt",
  "updatedAt"
FROM "conversation";

INSERT INTO "communication_surface" (
  "id",
  "kind",
  "status",
  "directConversationId",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  'DIRECT',
  'ACTIVE',
  "id",
  "createdAt",
  "updatedAt"
FROM "direct_conversation";

-- Domain rows own their authorization semantics; these triggers only guarantee
-- that every newly-created supported communication thread receives one surface.
CREATE FUNCTION "vimla_create_ai_thread_communication_surface"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "communication_surface" (
    "id",
    "kind",
    "status",
    "conversationId",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    gen_random_uuid(),
    'AI_THREAD',
    'ACTIVE',
    NEW."id",
    NEW."createdAt",
    NEW."updatedAt"
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "conversation_create_communication_surface"
AFTER INSERT ON "conversation"
FOR EACH ROW
EXECUTE FUNCTION "vimla_create_ai_thread_communication_surface"();

CREATE FUNCTION "vimla_create_direct_communication_surface"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "communication_surface" (
    "id",
    "kind",
    "status",
    "directConversationId",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    gen_random_uuid(),
    'DIRECT',
    'ACTIVE',
    NEW."id",
    NEW."createdAt",
    NEW."updatedAt"
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "direct_conversation_create_communication_surface"
AFTER INSERT ON "direct_conversation"
FOR EACH ROW
EXECUTE FUNCTION "vimla_create_direct_communication_surface"();
