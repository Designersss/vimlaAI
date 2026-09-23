CREATE TABLE "memory_item" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "scopeKind" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "projectId" TEXT,
  "conversationId" TEXT,
  "threadId" TEXT,
  "type" TEXT NOT NULL,
  "slotKey" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "classification" TEXT NOT NULL,
  "sensitivity" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "quality" DOUBLE PRECISION NOT NULL,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "origin" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'ACTIVE',
  "validFrom" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "supersedesId" TEXT,
  "invalidatedAt" TIMESTAMP(3),
  "invalidationReason" TEXT,
  "userConfirmedAt" TIMESTAMP(3),
  "userCorrectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "memory_item_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_item_scope_check" CHECK (
    ("scopeKind"='PERSONAL' AND "projectId" IS NULL AND "conversationId" IS NULL AND "threadId" IS NULL) OR
    ("scopeKind"='PROJECT' AND "conversationId" IS NULL AND "threadId" IS NULL AND
      ("projectId" IS NOT NULL OR ("state"='INVALIDATED' AND "invalidatedAt" IS NOT NULL))) OR
    ("scopeKind"='CONVERSATION' AND "projectId" IS NULL AND "threadId" IS NULL AND
      ("conversationId" IS NOT NULL OR ("state"='INVALIDATED' AND "invalidatedAt" IS NOT NULL))) OR
    ("scopeKind"='THREAD' AND "projectId" IS NULL AND "conversationId" IS NULL AND "threadId" IS NOT NULL)
  ),
  CONSTRAINT "memory_item_type_check" CHECK ("type" IN (
    'USER_FACT','USER_PREFERENCE','USER_GOAL','USER_RELATIONSHIP',
    'PROJECT_FACT','PROJECT_DECISION','PROJECT_STATE',
    'CONVERSATION_STATE','THREAD_STATE','DECISION','ENTITY_RELATION'
  )),
  CONSTRAINT "memory_item_scope_type_check" CHECK (
    ("scopeKind"='PERSONAL' AND "type" IN (
      'USER_FACT','USER_PREFERENCE','USER_GOAL','USER_RELATIONSHIP','DECISION','ENTITY_RELATION'
    )) OR
    ("scopeKind"='PROJECT' AND "type" IN (
      'PROJECT_FACT','PROJECT_DECISION','PROJECT_STATE','DECISION','ENTITY_RELATION'
    )) OR
    ("scopeKind"='CONVERSATION' AND "type" IN (
      'CONVERSATION_STATE','DECISION','ENTITY_RELATION'
    )) OR
    ("scopeKind"='THREAD' AND "type" IN (
      'THREAD_STATE','DECISION','ENTITY_RELATION'
    ))
  ),
  CONSTRAINT "memory_item_classification_check" CHECK ("classification" IN ('PUBLIC','INTERNAL','PRIVATE','RESTRICTED')),
  CONSTRAINT "memory_item_sensitivity_check" CHECK ("sensitivity" IN ('NORMAL','SENSITIVE')),
  CONSTRAINT "memory_item_origin_check" CHECK ("origin" IN ('AUTO_EXTRACTION','USER_EXPLICIT','USER_CORRECTION','E2EE_USER_DISCLOSURE')),
  CONSTRAINT "memory_item_origin_marker_check" CHECK (
    ("origin"='AUTO_EXTRACTION' AND "userConfirmedAt" IS NULL AND "userCorrectedAt" IS NULL)
    OR ("origin"='USER_EXPLICIT' AND "userConfirmedAt" IS NOT NULL AND "userCorrectedAt" IS NULL)
    OR ("origin"='USER_CORRECTION' AND "userConfirmedAt" IS NOT NULL AND "userCorrectedAt" IS NOT NULL)
    OR ("origin"='E2EE_USER_DISCLOSURE' AND "userConfirmedAt" IS NOT NULL AND "userCorrectedAt" IS NULL)
  ),
  CONSTRAINT "memory_item_state_check" CHECK ("state" IN ('ACTIVE','SUPERSEDED','INVALIDATED')),
  CONSTRAINT "memory_item_scores_check" CHECK ("confidence">=0 AND "confidence"<=1 AND "quality">=0 AND "quality"<=1),
  CONSTRAINT "memory_item_generation_check" CHECK ("generation">=1),
  CONSTRAINT "memory_item_expiry_check" CHECK ("expiresAt" IS NULL OR "expiresAt">"validFrom"),
  CONSTRAINT "memory_item_invalidation_check" CHECK (
    ("state"='INVALIDATED' AND "invalidatedAt" IS NOT NULL AND "invalidationReason" IS NOT NULL)
    OR ("state"<>'INVALIDATED' AND "invalidatedAt" IS NULL)
  )
);

CREATE UNIQUE INDEX "memory_item_supersedesId_key" ON "memory_item"("supersedesId");
CREATE UNIQUE INDEX "memory_item_active_slot_key" ON "memory_item"("scopeKey","slotKey") WHERE "state"='ACTIVE';
CREATE INDEX "memory_item_ownerUserId_state_validFrom_idx" ON "memory_item"("ownerUserId","state","validFrom");
CREATE INDEX "memory_item_projectId_state_validFrom_idx" ON "memory_item"("projectId","state","validFrom");
CREATE INDEX "memory_item_conversationId_state_validFrom_idx" ON "memory_item"("conversationId","state","validFrom");
CREATE INDEX "memory_item_scopeKey_state_validFrom_idx" ON "memory_item"("scopeKey","state","validFrom");
CREATE INDEX "memory_item_type_state_validFrom_idx" ON "memory_item"("type","state","validFrom");

ALTER TABLE "memory_item" ADD CONSTRAINT "memory_item_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "memory_item" ADD CONSTRAINT "memory_item_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "memory_item" ADD CONSTRAINT "memory_item_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "memory_item" ADD CONSTRAINT "memory_item_supersedesId_fkey"
  FOREIGN KEY ("supersedesId") REFERENCES "memory_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "memory_source_ref" (
  "id" TEXT NOT NULL,
  "memoryId" TEXT NOT NULL,
  "provenance" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceVersion" TEXT,
  "sourceScopeKind" TEXT NOT NULL,
  "sourceScopeId" TEXT,
  "disclosedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_source_ref_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_source_ref_provenance_check" CHECK ("provenance" IN ('AUTO_EXTRACTION','USER_EXPLICIT','USER_CORRECTION','E2EE_USER_DISCLOSURE')),
  CONSTRAINT "memory_source_ref_source_type_check" CHECK ("sourceType" IN (
    'MESSAGE','WORKSPACE_OBJECT','PROJECT','ARTIFACT',
    'USER_EXPLICIT','USER_CORRECTION','E2EE_USER_DISCLOSURE'
  )),
  CONSTRAINT "memory_source_ref_provenance_source_check" CHECK (
    ("provenance"='USER_EXPLICIT' AND "sourceType" IN ('USER_EXPLICIT','MESSAGE','WORKSPACE_OBJECT','PROJECT','ARTIFACT')) OR
    ("provenance"='USER_CORRECTION' AND "sourceType"='USER_CORRECTION') OR
    ("provenance"='E2EE_USER_DISCLOSURE' AND "sourceType"='E2EE_USER_DISCLOSURE') OR
    ("provenance"='AUTO_EXTRACTION' AND "sourceType" IN ('MESSAGE','WORKSPACE_OBJECT','PROJECT','ARTIFACT'))
  ),
  CONSTRAINT "memory_source_ref_scope_check" CHECK ("sourceScopeKind" IN ('PERSONAL','PROJECT','CONVERSATION','THREAD','DIRECT_CHAT')),
  CONSTRAINT "memory_source_ref_scope_id_check" CHECK ("sourceScopeId" IS NOT NULL),
  CONSTRAINT "memory_source_ref_version_check" CHECK (
    "sourceType"='USER_EXPLICIT'
    OR "sourceVersion" IS NOT NULL
  ),
  CONSTRAINT "memory_source_ref_e2ee_disclosure_check" CHECK (
    "sourceType"<>'E2EE_USER_DISCLOSURE'
    OR "disclosedAt" IS NOT NULL
  )
);
CREATE UNIQUE INDEX "memory_source_ref_identity_key" ON "memory_source_ref"("memoryId","provenance","sourceType","sourceId");
CREATE INDEX "memory_source_ref_source_idx" ON "memory_source_ref"("sourceType","sourceId");
CREATE INDEX "memory_source_ref_scope_idx" ON "memory_source_ref"("sourceScopeKind","sourceScopeId");
ALTER TABLE "memory_source_ref" ADD CONSTRAINT "memory_source_ref_memoryId_fkey"
  FOREIGN KEY ("memoryId") REFERENCES "memory_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "compacted_context_state" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "scopeKind" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "projectId" TEXT,
  "conversationId" TEXT,
  "threadId" TEXT,
  "version" INTEGER NOT NULL,
  "classification" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "sourceRefs" JSONB NOT NULL,
  "sourceFingerprint" TEXT NOT NULL,
  "coveredFromSourceId" TEXT NOT NULL,
  "coveredToSourceId" TEXT NOT NULL,
  "coveredFromAt" TIMESTAMP(3) NOT NULL,
  "coveredToAt" TIMESTAMP(3) NOT NULL,
  "sourceCount" INTEGER NOT NULL,
  "inputTokenEstimate" INTEGER NOT NULL,
  "outputTokenEstimate" INTEGER NOT NULL,
  "validFrom" TIMESTAMP(3) NOT NULL,
  "invalidatedAt" TIMESTAMP(3),
  "invalidationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compacted_context_state_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "compacted_context_state_scope_check" CHECK (
    ("scopeKind"='PROJECT' AND "conversationId" IS NULL AND "threadId" IS NULL AND
      ("projectId" IS NOT NULL OR "invalidatedAt" IS NOT NULL)) OR
    ("scopeKind"='CONVERSATION' AND "projectId" IS NULL AND "threadId" IS NULL AND
      ("conversationId" IS NOT NULL OR "invalidatedAt" IS NOT NULL)) OR
    ("scopeKind"='THREAD' AND "projectId" IS NULL AND "conversationId" IS NULL AND "threadId" IS NOT NULL)
  ),
  CONSTRAINT "compacted_context_state_classification_check" CHECK ("classification" IN ('PUBLIC','INTERNAL','PRIVATE','RESTRICTED')),
  CONSTRAINT "compacted_context_state_version_check" CHECK ("version">=1),
  CONSTRAINT "compacted_context_state_source_count_check" CHECK ("sourceCount">=1),
  CONSTRAINT "compacted_context_state_token_check" CHECK ("inputTokenEstimate">=1 AND "outputTokenEstimate">=1),
  CONSTRAINT "compacted_context_state_range_check" CHECK ("coveredFromAt"<="coveredToAt"),
  CONSTRAINT "compacted_context_state_invalidation_check" CHECK (
    ("invalidatedAt" IS NULL AND "invalidationReason" IS NULL)
    OR ("invalidatedAt" IS NOT NULL AND "invalidationReason" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "compacted_context_state_scope_version_key" ON "compacted_context_state"("scopeKey","version");
CREATE UNIQUE INDEX "compacted_context_state_active_scope_key" ON "compacted_context_state"("scopeKey") WHERE "invalidatedAt" IS NULL;
CREATE INDEX "compacted_context_state_owner_idx" ON "compacted_context_state"("ownerUserId","invalidatedAt","validFrom");
CREATE INDEX "compacted_context_state_project_idx" ON "compacted_context_state"("projectId","invalidatedAt","validFrom");
CREATE INDEX "compacted_context_state_conversation_idx" ON "compacted_context_state"("conversationId","invalidatedAt","validFrom");
CREATE INDEX "compacted_context_state_scope_idx" ON "compacted_context_state"("scopeKey","invalidatedAt","version");
ALTER TABLE "compacted_context_state" ADD CONSTRAINT "compacted_context_state_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compacted_context_state" ADD CONSTRAINT "compacted_context_state_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "compacted_context_state" ADD CONSTRAINT "compacted_context_state_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;


CREATE TABLE "memory_extraction_receipt" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceVersion" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "candidateCount" INTEGER NOT NULL DEFAULT 0,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "extractedAt" TIMESTAMP(3),
  "compactedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "memory_extraction_receipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_extraction_receipt_source_type_check"
    CHECK ("sourceType" IN ('MESSAGE')),
  CONSTRAINT "memory_extraction_receipt_status_check"
    CHECK ("status" IN ('QUEUED','PENDING','COMPLETED','FAILED','SKIPPED')),
  CONSTRAINT "memory_extraction_receipt_candidate_count_check"
    CHECK ("candidateCount">=0),
  CONSTRAINT "memory_extraction_receipt_attempt_count_check"
    CHECK ("attemptCount">=0 AND "attemptCount"<=5),
  CONSTRAINT "memory_extraction_receipt_attempt_state_check"
    CHECK (
      ("status"='QUEUED' AND "attemptCount"=0)
      OR ("status"='SKIPPED')
      OR ("status" IN ('PENDING','COMPLETED','FAILED') AND "attemptCount">=1)
    ),
  CONSTRAINT "memory_extraction_receipt_completed_stages_check"
    CHECK (
      "status"<>'COMPLETED'
      OR ("extractedAt" IS NOT NULL AND "compactedAt" IS NOT NULL)
    ),
  CONSTRAINT "memory_extraction_receipt_candidate_stage_check"
    CHECK ("candidateCount"=0 OR "extractedAt" IS NOT NULL)
);
CREATE UNIQUE INDEX "memory_extraction_receipt_source_key"
  ON "memory_extraction_receipt"("sourceType","sourceId","sourceVersion");
CREATE INDEX "memory_extraction_receipt_owner_status_idx"
  ON "memory_extraction_receipt"("ownerUserId","status","updatedAt");
ALTER TABLE "memory_extraction_receipt"
  ADD CONSTRAINT "memory_extraction_receipt_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "user"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
