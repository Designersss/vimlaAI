CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE "semantic_source" (
  "id" TEXT PRIMARY KEY, "kind" TEXT NOT NULL, "sourceId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "projectId" TEXT REFERENCES "project"("id") ON DELETE CASCADE,
  "revision" BIGINT NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "generation" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','RUNNING','READY','SKIPPED','FAILED')),
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" BETWEEN 0 AND 5),
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3), "fingerprint" TEXT, "errorCode" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("kind" IN ('MESSAGE','NOTE','PROJECT','ARTIFACT')),
  CHECK (("kind" = 'PROJECT' AND "projectId" = "sourceId") OR ("kind" <> 'PROJECT' AND "projectId" IS NULL)),
  CHECK (("status" = 'RUNNING') = ("leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL)),
  UNIQUE ("kind", "sourceId")
);
CREATE INDEX "semantic_source_status_availableAt_idx" ON "semantic_source"("status", "availableAt");
CREATE INDEX "semantic_source_ownerUserId_generation_status_idx" ON "semantic_source"("ownerUserId", "generation", "status");
CREATE INDEX "semantic_source_projectId_generation_status_idx" ON "semantic_source"("projectId", "generation", "status");
CREATE TABLE "semantic_chunk" (
  "id" TEXT PRIMARY KEY,
  "sourceKey" TEXT NOT NULL REFERENCES "semantic_source"("id") ON DELETE CASCADE,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal" BETWEEN 0 AND 31),
  "fingerprint" TEXT NOT NULL,
  "embedding" vector NOT NULL CHECK (vector_dims("embedding") BETWEEN 1 AND 2000 AND vector_norm("embedding") > 0),
  UNIQUE ("sourceKey", "ordinal")
);
CREATE TABLE "semantic_admission" ("key" TEXT PRIMARY KEY, "windowStart" TIMESTAMP(3) NOT NULL, "count" INTEGER NOT NULL CHECK ("count" >= 0));

-- The registry is also the durable outbox: no plaintext in jobs or index metadata.
CREATE FUNCTION vimla_semantic_touch(k TEXT, sid TEXT, uid TEXT, pid TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE sk TEXT := k || ':' || sid;
BEGIN
  INSERT INTO semantic_source (id, kind, "sourceId", "ownerUserId", "projectId") VALUES (sk,k,sid,uid,pid)
  ON CONFLICT (id) DO UPDATE SET "ownerUserId"=EXCLUDED."ownerUserId", "projectId"=EXCLUDED."projectId",
    revision=semantic_source.revision+1, status='PENDING', attempts=0, "availableAt"=CURRENT_TIMESTAMP,
    "leaseToken"=NULL, "leaseUntil"=NULL, fingerprint=NULL, "errorCode"=NULL, "updatedAt"=CURRENT_TIMESTAMP;
  DELETE FROM semantic_chunk WHERE "sourceKey"=sk;
END $$;
CREATE FUNCTION vimla_semantic_message() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN DELETE FROM semantic_source WHERE id='MESSAGE:'||OLD.id; RETURN NULL; END IF;
  IF NEW.status='COMPLETE' AND NEW.role IN ('USER','ASSISTANT') THEN
    PERFORM vimla_semantic_touch('MESSAGE', NEW.id, (SELECT "userId" FROM conversation WHERE id=NEW."conversationId"));
  ELSE DELETE FROM semantic_source WHERE id='MESSAGE:'||NEW.id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER semantic_message AFTER INSERT OR UPDATE OF content,status,role,"conversationId" OR DELETE ON message FOR EACH ROW EXECUTE FUNCTION vimla_semantic_message();
CREATE FUNCTION vimla_semantic_note() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE oid TEXT; obj workspace_object;
BEGIN
  IF TG_TABLE_NAME='workspace_note' THEN
    IF TG_OP='DELETE' THEN DELETE FROM semantic_source WHERE id='NOTE:'||OLD."objectId"; RETURN NULL; END IF;
    oid := NEW."objectId";
  ELSE
    IF TG_OP='DELETE' THEN DELETE FROM semantic_source WHERE id='NOTE:'||OLD.id; RETURN NULL; END IF;
    oid := NEW.id;
  END IF;
  SELECT * INTO obj FROM workspace_object WHERE id=oid;
  IF obj.kind='NOTE' AND obj."deletedAt" IS NULL AND obj."scopeType"='PERSONAL' AND EXISTS (SELECT 1 FROM workspace_note WHERE "objectId"=oid) THEN
    PERFORM vimla_semantic_touch('NOTE',oid,obj."personalOwnerUserId");
  ELSE DELETE FROM semantic_source WHERE id='NOTE:'||oid;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER semantic_note AFTER INSERT OR UPDATE OR DELETE ON workspace_note FOR EACH ROW EXECUTE FUNCTION vimla_semantic_note();
CREATE TRIGGER semantic_workspace AFTER UPDATE OR DELETE ON workspace_object FOR EACH ROW EXECUTE FUNCTION vimla_semantic_note();
CREATE FUNCTION vimla_semantic_project() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN DELETE FROM semantic_source WHERE id='PROJECT:'||OLD.id; RETURN NULL; END IF;
  PERFORM vimla_semantic_touch('PROJECT',NEW.id,NEW."ownerUserId",NEW.id); RETURN NULL;
END $$;
CREATE TRIGGER semantic_project AFTER INSERT OR UPDATE OF name,description,"ownerUserId" OR DELETE ON project FOR EACH ROW EXECUTE FUNCTION vimla_semantic_project();
CREATE FUNCTION vimla_semantic_artifact() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE aid TEXT; uid TEXT;
BEGIN
  IF TG_TABLE_NAME='artifact_version' THEN
    IF TG_OP='DELETE' THEN aid := OLD."artifactId"; ELSE aid := NEW."artifactId"; END IF;
  ELSE
    IF TG_OP='DELETE' THEN DELETE FROM semantic_source WHERE id='ARTIFACT:'||OLD.id; RETURN NULL; END IF;
    aid := NEW.id;
  END IF;
  SELECT p."userId" INTO uid FROM artifact a JOIN invocation i ON i.id=a."creatorInvocationId" JOIN execution_plan p ON p.id=i."planId" WHERE a.id=aid;
  IF uid IS NOT NULL THEN PERFORM vimla_semantic_touch('ARTIFACT',aid,uid); END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER semantic_artifact AFTER INSERT OR UPDATE OR DELETE ON artifact FOR EACH ROW EXECUTE FUNCTION vimla_semantic_artifact();
CREATE TRIGGER semantic_artifact_version AFTER INSERT OR UPDATE OR DELETE ON artifact_version FOR EACH ROW EXECUTE FUNCTION vimla_semantic_artifact();
-- Backfill only source references; inference is always gated by worker configuration.
INSERT INTO semantic_source (id,kind,"sourceId","ownerUserId")
  SELECT 'MESSAGE:'||m.id,'MESSAGE',m.id,c."userId" FROM message m JOIN conversation c ON c.id=m."conversationId" WHERE m.status='COMPLETE' AND m.role IN ('USER','ASSISTANT');
INSERT INTO semantic_source (id,kind,"sourceId","ownerUserId")
  SELECT 'NOTE:'||o.id,'NOTE',o.id,o."personalOwnerUserId" FROM workspace_object o JOIN workspace_note n ON n."objectId"=o.id WHERE o."deletedAt" IS NULL AND o."scopeType"='PERSONAL';
INSERT INTO semantic_source (id,kind,"sourceId","ownerUserId","projectId") SELECT 'PROJECT:'||id,'PROJECT',id,"ownerUserId",id FROM project;
INSERT INTO semantic_source (id,kind,"sourceId","ownerUserId")
  SELECT 'ARTIFACT:'||a.id,'ARTIFACT',a.id,p."userId" FROM artifact a JOIN invocation i ON i.id=a."creatorInvocationId" JOIN execution_plan p ON p.id=i."planId";
CREATE TABLE semantic_generation (
  sequence BIGSERIAL UNIQUE NOT NULL, id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, "modelRevision" TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions BETWEEN 1 AND 2000), "chunkVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
