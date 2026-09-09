-- Phase 6: personal Workspace objects (TASK, REMINDER, LIST, NOTE).
-- PROJECT scope is deferred to Phase 8; no dangling projectId.
-- TOPUP buckets still never expire.

ALTER TABLE "user_preference" ADD COLUMN "timezone" TEXT;

CREATE TABLE "workspace_object" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL DEFAULT 'PERSONAL',
    "personalOwnerUserId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "sourceConversationId" TEXT,
    "sourceMessageId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_object_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workspace_object_scope_personal_chk" CHECK ("scopeType" = 'PERSONAL'),
    CONSTRAINT "workspace_object_kind_chk" CHECK ("kind" IN ('TASK', 'REMINDER', 'LIST', 'NOTE'))
);

CREATE INDEX "workspace_object_personalOwnerUserId_kind_deletedAt_idx" ON "workspace_object"("personalOwnerUserId", "kind", "deletedAt");
CREATE INDEX "workspace_object_personalOwnerUserId_archivedAt_updatedAt_idx" ON "workspace_object"("personalOwnerUserId", "archivedAt", "updatedAt");
CREATE INDEX "workspace_object_kind_deletedAt_updatedAt_idx" ON "workspace_object"("kind", "deletedAt", "updatedAt");

ALTER TABLE "workspace_object"
    ADD CONSTRAINT "workspace_object_personalOwnerUserId_fkey"
    FOREIGN KEY ("personalOwnerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workspace_object"
    ADD CONSTRAINT "workspace_object_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workspace_object"
    ADD CONSTRAINT "workspace_object_sourceConversationId_fkey"
    FOREIGN KEY ("sourceConversationId") REFERENCES "conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workspace_object"
    ADD CONSTRAINT "workspace_object_sourceMessageId_fkey"
    FOREIGN KEY ("sourceMessageId") REFERENCES "message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "workspace_task" (
    "objectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL,
    "priority" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "workspace_task_pkey" PRIMARY KEY ("objectId"),
    CONSTRAINT "workspace_task_status_chk" CHECK ("status" IN ('TODO', 'IN_PROGRESS', 'DONE', 'CANCELED')),
    CONSTRAINT "workspace_task_priority_chk" CHECK ("priority" IS NULL OR "priority" IN ('LOW', 'NORMAL', 'HIGH')),
    CONSTRAINT "workspace_task_completed_chk" CHECK (
        ("status" = 'DONE' AND "completedAt" IS NOT NULL)
        OR ("status" <> 'DONE' AND "completedAt" IS NULL)
    )
);

CREATE INDEX "workspace_task_status_dueAt_idx" ON "workspace_task"("status", "dueAt");

ALTER TABLE "workspace_task"
    ADD CONSTRAINT "workspace_task_objectId_fkey"
    FOREIGN KEY ("objectId") REFERENCES "workspace_object"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "workspace_reminder" (
    "objectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "linkedTaskObjectId" TEXT,
    "canceledAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "workspace_reminder_pkey" PRIMARY KEY ("objectId"),
    CONSTRAINT "workspace_reminder_status_chk" CHECK ("status" IN ('PENDING', 'CANCELED', 'DELIVERED', 'FAILED'))
);

CREATE INDEX "workspace_reminder_status_scheduledAt_idx" ON "workspace_reminder"("status", "scheduledAt");
CREATE INDEX "workspace_reminder_linkedTaskObjectId_idx" ON "workspace_reminder"("linkedTaskObjectId");

ALTER TABLE "workspace_reminder"
    ADD CONSTRAINT "workspace_reminder_objectId_fkey"
    FOREIGN KEY ("objectId") REFERENCES "workspace_object"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspace_reminder"
    ADD CONSTRAINT "workspace_reminder_linkedTaskObjectId_fkey"
    FOREIGN KEY ("linkedTaskObjectId") REFERENCES "workspace_object"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "workspace_list" (
    "objectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "workspace_list_pkey" PRIMARY KEY ("objectId"),
    CONSTRAINT "workspace_list_type_chk" CHECK ("type" IN ('PLAIN', 'CHECKLIST'))
);

CREATE INDEX "workspace_list_type_idx" ON "workspace_list"("type");

ALTER TABLE "workspace_list"
    ADD CONSTRAINT "workspace_list_objectId_fkey"
    FOREIGN KEY ("objectId") REFERENCES "workspace_object"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "workspace_list_item" (
    "id" TEXT NOT NULL,
    "listObjectId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_list_item_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "workspace_list_item_listObjectId_position_idx" ON "workspace_list_item"("listObjectId", "position");

ALTER TABLE "workspace_list_item"
    ADD CONSTRAINT "workspace_list_item_listObjectId_fkey"
    FOREIGN KEY ("listObjectId") REFERENCES "workspace_list"("objectId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "workspace_note" (
    "objectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contentMarkdown" TEXT NOT NULL,
    "pinnedAt" TIMESTAMP(3),

    CONSTRAINT "workspace_note_pkey" PRIMARY KEY ("objectId")
);

CREATE INDEX "workspace_note_pinnedAt_idx" ON "workspace_note"("pinnedAt");

ALTER TABLE "workspace_note"
    ADD CONSTRAINT "workspace_note_objectId_fkey"
    FOREIGN KEY ("objectId") REFERENCES "workspace_object"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION vimla_workspace_kind_matches_child()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  object_kind TEXT;
BEGIN
  SELECT "kind" INTO object_kind FROM "workspace_object" WHERE "id" = NEW."objectId";
  IF object_kind IS NULL THEN
    RAISE EXCEPTION 'workspace object % does not exist', NEW."objectId";
  END IF;
  IF TG_TABLE_NAME = 'workspace_task' AND object_kind <> 'TASK' THEN
    RAISE EXCEPTION 'workspace object kind mismatch';
  END IF;
  IF TG_TABLE_NAME = 'workspace_reminder' AND object_kind <> 'REMINDER' THEN
    RAISE EXCEPTION 'workspace object kind mismatch';
  END IF;
  IF TG_TABLE_NAME = 'workspace_list' AND object_kind <> 'LIST' THEN
    RAISE EXCEPTION 'workspace object kind mismatch';
  END IF;
  IF TG_TABLE_NAME = 'workspace_note' AND object_kind <> 'NOTE' THEN
    RAISE EXCEPTION 'workspace object kind mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workspace_task_kind_match
BEFORE INSERT OR UPDATE OF "objectId" ON "workspace_task"
FOR EACH ROW EXECUTE FUNCTION vimla_workspace_kind_matches_child();

CREATE TRIGGER workspace_reminder_kind_match
BEFORE INSERT OR UPDATE OF "objectId" ON "workspace_reminder"
FOR EACH ROW EXECUTE FUNCTION vimla_workspace_kind_matches_child();

CREATE TRIGGER workspace_list_kind_match
BEFORE INSERT OR UPDATE OF "objectId" ON "workspace_list"
FOR EACH ROW EXECUTE FUNCTION vimla_workspace_kind_matches_child();

CREATE TRIGGER workspace_note_kind_match
BEFORE INSERT OR UPDATE OF "objectId" ON "workspace_note"
FOR EACH ROW EXECUTE FUNCTION vimla_workspace_kind_matches_child();
