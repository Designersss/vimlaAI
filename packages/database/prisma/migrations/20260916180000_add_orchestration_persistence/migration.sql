-- Context-aware orchestration persistence. Additive only.
-- Existing Operator, AiRequest, billing, workspace, notification and E2EE history remains authoritative.
-- No authoritative monetary values are introduced in orchestration tables.

CREATE TABLE "execution_plan" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "planHash" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "maxParallelism" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3),
    "frozenAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "execution_plan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "execution_plan_schemaVersion_chk" CHECK ("schemaVersion" > 0),
    CONSTRAINT "execution_plan_version_chk" CHECK ("version" > 0),
    CONSTRAINT "execution_plan_maxParallelism_chk" CHECK ("maxParallelism" > 0),
    CONSTRAINT "execution_plan_status_chk" CHECK (
        "status" IN ('PLANNING', 'PLANNED', 'RUNNING', 'PARTIAL', 'COMPLETED', 'FAILED', 'CANCELED')
    )
);

CREATE UNIQUE INDEX "execution_plan_messageId_key" ON "execution_plan"("messageId");
CREATE INDEX "execution_plan_userId_createdAt_idx" ON "execution_plan"("userId", "createdAt");
CREATE INDEX "execution_plan_conversationId_createdAt_idx" ON "execution_plan"("conversationId", "createdAt");
CREATE INDEX "execution_plan_status_createdAt_idx" ON "execution_plan"("status", "createdAt");

ALTER TABLE "execution_plan"
    ADD CONSTRAINT "execution_plan_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "execution_plan"
    ADD CONSTRAINT "execution_plan_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "execution_plan"
    ADD CONSTRAINT "execution_plan_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "invocation" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetModelSlug" TEXT,
    "targetAgentId" TEXT,
    "outputDeclarations" JSONB NOT NULL,
    "acceptanceCriteria" JSONB NOT NULL,
    "riskClass" TEXT NOT NULL,
    "approvalPolicy" TEXT NOT NULL,
    "failurePolicy" TEXT NOT NULL,
    "joinPolicy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invocation_sequence_chk" CHECK ("sequence" >= 0),
    CONSTRAINT "invocation_targetKind_chk" CHECK (
        "targetKind" IN ('VIMLA', 'AI_AUTO', 'AI_MODEL', 'EVALUATOR', 'AGENT')
    ),
    CONSTRAINT "invocation_targetPayload_chk" CHECK (
        ("targetKind" = 'AI_MODEL' AND "targetModelSlug" IS NOT NULL AND "targetAgentId" IS NULL)
        OR ("targetKind" = 'AGENT' AND "targetAgentId" IS NOT NULL AND "targetModelSlug" IS NULL)
        OR ("targetKind" IN ('VIMLA', 'AI_AUTO', 'EVALUATOR') AND "targetModelSlug" IS NULL AND "targetAgentId" IS NULL)
    ),
    CONSTRAINT "invocation_riskClass_chk" CHECK (
        "riskClass" IN ('READ_ONLY', 'INTERNAL_WRITE', 'EXTERNAL_SIDE_EFFECT', 'DESTRUCTIVE', 'FINANCIAL')
    ),
    CONSTRAINT "invocation_approvalPolicy_chk" CHECK (
        "approvalPolicy" IN ('AUTO', 'USER_CONFIRMATION', 'HUMAN_APPROVAL')
    ),
    CONSTRAINT "invocation_failurePolicy_chk" CHECK ("failurePolicy" IN ('FAIL_PLAN', 'CONTINUE')),
    CONSTRAINT "invocation_joinPolicy_chk" CHECK ("joinPolicy" IN ('ALL_REQUIRED', 'ANY_REQUIRED', 'ALL_SETTLED')),
    CONSTRAINT "invocation_status_chk" CHECK (
        "status" IN ('PENDING', 'READY', 'RUNNING', 'WAITING_APPROVAL', 'COMPLETED', 'FAILED', 'SKIPPED', 'CANCELED')
    )
);

CREATE UNIQUE INDEX "invocation_planId_sequence_key" ON "invocation"("planId", "sequence");
CREATE INDEX "invocation_planId_status_idx" ON "invocation"("planId", "status");
CREATE INDEX "invocation_status_createdAt_idx" ON "invocation"("status", "createdAt");

ALTER TABLE "invocation"
    ADD CONSTRAINT "invocation_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "execution_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "invocation_dependency" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "fromInvocationId" TEXT NOT NULL,
    "toInvocationId" TEXT NOT NULL,
    "conditionKind" TEXT NOT NULL,
    "conditionOutcome" TEXT NOT NULL DEFAULT '',
    "inputBindings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invocation_dependency_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invocation_dependency_no_self_chk" CHECK ("fromInvocationId" <> "toInvocationId"),
    CONSTRAINT "invocation_dependency_conditionKind_chk" CHECK (
        "conditionKind" IN ('DATA', 'ON_SUCCESS', 'ON_FAILURE', 'ALWAYS', 'OUTCOME')
    ),
    CONSTRAINT "invocation_dependency_outcome_chk" CHECK (
        ("conditionKind" = 'OUTCOME' AND length(trim("conditionOutcome")) > 0)
        OR ("conditionKind" <> 'OUTCOME' AND "conditionOutcome" = '')
    )
);

CREATE UNIQUE INDEX "invocation_dependency_fromInvocationId_toInvocationId_conditionKind_conditionOutcome_key"
    ON "invocation_dependency"("fromInvocationId", "toInvocationId", "conditionKind", "conditionOutcome");
CREATE INDEX "invocation_dependency_planId_idx" ON "invocation_dependency"("planId");
CREATE INDEX "invocation_dependency_toInvocationId_conditionKind_idx"
    ON "invocation_dependency"("toInvocationId", "conditionKind");

ALTER TABLE "invocation_dependency"
    ADD CONSTRAINT "invocation_dependency_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "execution_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invocation_dependency"
    ADD CONSTRAINT "invocation_dependency_fromInvocationId_fkey"
    FOREIGN KEY ("fromInvocationId") REFERENCES "invocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invocation_dependency"
    ADD CONSTRAINT "invocation_dependency_toInvocationId_fkey"
    FOREIGN KEY ("toInvocationId") REFERENCES "invocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "invocation_run" (
    "id" TEXT NOT NULL,
    "invocationId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "outcome" TEXT,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invocation_run_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invocation_run_attempt_chk" CHECK ("attempt" > 0),
    CONSTRAINT "invocation_run_status_chk" CHECK (
        "status" IN ('CREATED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED')
    )
);

CREATE UNIQUE INDEX "invocation_run_idempotencyKey_key" ON "invocation_run"("idempotencyKey");
CREATE UNIQUE INDEX "invocation_run_invocationId_attempt_key" ON "invocation_run"("invocationId", "attempt");
CREATE INDEX "invocation_run_invocationId_status_idx" ON "invocation_run"("invocationId", "status");
CREATE INDEX "invocation_run_status_createdAt_idx" ON "invocation_run"("status", "createdAt");

ALTER TABLE "invocation_run"
    ADD CONSTRAINT "invocation_run_invocationId_fkey"
    FOREIGN KEY ("invocationId") REFERENCES "invocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "context_snapshot" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "context_snapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "context_snapshot_version_chk" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "context_snapshot_planId_key" ON "context_snapshot"("planId");
CREATE INDEX "context_snapshot_createdAt_idx" ON "context_snapshot"("createdAt");

ALTER TABLE "context_snapshot"
    ADD CONSTRAINT "context_snapshot_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "execution_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "context_snapshot_item" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" TEXT,
    "fingerprint" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "contentRef" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "context_snapshot_item_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "context_snapshot_item_sequence_chk" CHECK ("sequence" >= 0)
);

CREATE UNIQUE INDEX "context_snapshot_item_snapshotId_sequence_key"
    ON "context_snapshot_item"("snapshotId", "sequence");
CREATE INDEX "context_snapshot_item_sourceType_sourceId_idx"
    ON "context_snapshot_item"("sourceType", "sourceId");

ALTER TABLE "context_snapshot_item"
    ADD CONSTRAINT "context_snapshot_item_snapshotId_fkey"
    FOREIGN KEY ("snapshotId") REFERENCES "context_snapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "context_bundle" (
    "id" TEXT NOT NULL,
    "invocationId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "context_bundle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "context_bundle_invocationId_key" ON "context_bundle"("invocationId");
CREATE INDEX "context_bundle_snapshotId_idx" ON "context_bundle"("snapshotId");

ALTER TABLE "context_bundle"
    ADD CONSTRAINT "context_bundle_invocationId_fkey"
    FOREIGN KEY ("invocationId") REFERENCES "invocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "context_bundle"
    ADD CONSTRAINT "context_bundle_snapshotId_fkey"
    FOREIGN KEY ("snapshotId") REFERENCES "context_snapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "artifact" (
    "id" TEXT NOT NULL,
    "creatorInvocationId" TEXT NOT NULL,
    "outputName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "artifact_type_chk" CHECK (
        "type" IN ('TEXT', 'PROMPT', 'DOCUMENT', 'CODE', 'IMAGE', 'PLAN', 'FILE', 'PATCH')
    )
);

CREATE UNIQUE INDEX "artifact_creatorInvocationId_outputName_key"
    ON "artifact"("creatorInvocationId", "outputName");
CREATE INDEX "artifact_creatorInvocationId_createdAt_idx" ON "artifact"("creatorInvocationId", "createdAt");
CREATE INDEX "artifact_type_createdAt_idx" ON "artifact"("type", "createdAt");

ALTER TABLE "artifact"
    ADD CONSTRAINT "artifact_creatorInvocationId_fkey"
    FOREIGN KEY ("creatorInvocationId") REFERENCES "invocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "artifact_version" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentRef" TEXT,
    "contentJson" JSONB,
    "fingerprint" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_version_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "artifact_version_version_chk" CHECK ("version" > 0),
    CONSTRAINT "artifact_version_content_chk" CHECK (num_nonnulls("contentRef", "contentJson") = 1)
);

CREATE UNIQUE INDEX "artifact_version_artifactId_version_key" ON "artifact_version"("artifactId", "version");
CREATE INDEX "artifact_version_fingerprint_idx" ON "artifact_version"("fingerprint");

ALTER TABLE "artifact_version"
    ADD CONSTRAINT "artifact_version_artifactId_fkey"
    FOREIGN KEY ("artifactId") REFERENCES "artifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "artifact_access_grant" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "granteeUserId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "artifact_access_grant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "artifact_access_grant_artifactId_granteeUserId_permission_key"
    ON "artifact_access_grant"("artifactId", "granteeUserId", "permission");
CREATE INDEX "artifact_access_grant_granteeUserId_revokedAt_idx"
    ON "artifact_access_grant"("granteeUserId", "revokedAt");

ALTER TABLE "artifact_access_grant"
    ADD CONSTRAINT "artifact_access_grant_artifactId_fkey"
    FOREIGN KEY ("artifactId") REFERENCES "artifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "artifact_access_grant"
    ADD CONSTRAINT "artifact_access_grant_granteeUserId_fkey"
    FOREIGN KEY ("granteeUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "evaluation" (
    "id" TEXT NOT NULL,
    "invocationRunId" TEXT NOT NULL,
    "evaluatorKind" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "criteriaResults" JSONB NOT NULL,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "evaluation_invocationRunId_key" ON "evaluation"("invocationRunId");
CREATE INDEX "evaluation_outcome_createdAt_idx" ON "evaluation"("outcome", "createdAt");

ALTER TABLE "evaluation"
    ADD CONSTRAINT "evaluation_invocationRunId_fkey"
    FOREIGN KEY ("invocationRunId") REFERENCES "invocation_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ai_execution" (
    "id" TEXT NOT NULL,
    "invocationRunId" TEXT NOT NULL,
    "aiRequestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_execution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_execution_invocationRunId_key" ON "ai_execution"("invocationRunId");
CREATE UNIQUE INDEX "ai_execution_aiRequestId_key" ON "ai_execution"("aiRequestId");

ALTER TABLE "ai_execution"
    ADD CONSTRAINT "ai_execution_invocationRunId_fkey"
    FOREIGN KEY ("invocationRunId") REFERENCES "invocation_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_execution"
    ADD CONSTRAINT "ai_execution_aiRequestId_fkey"
    FOREIGN KEY ("aiRequestId") REFERENCES "ai_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "tool_execution" (
    "id" TEXT NOT NULL,
    "invocationRunId" TEXT NOT NULL,
    "operatorRunStepId" TEXT,
    "toolName" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "objectType" TEXT,
    "objectId" TEXT,
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tool_execution_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tool_execution_status_chk" CHECK (
        "status" IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED')
    )
);

CREATE UNIQUE INDEX "tool_execution_invocationRunId_key" ON "tool_execution"("invocationRunId");
CREATE UNIQUE INDEX "tool_execution_operatorRunStepId_key" ON "tool_execution"("operatorRunStepId");
CREATE UNIQUE INDEX "tool_execution_idempotencyKey_key" ON "tool_execution"("idempotencyKey");
CREATE INDEX "tool_execution_toolName_status_idx" ON "tool_execution"("toolName", "status");

ALTER TABLE "tool_execution"
    ADD CONSTRAINT "tool_execution_invocationRunId_fkey"
    FOREIGN KEY ("invocationRunId") REFERENCES "invocation_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tool_execution"
    ADD CONSTRAINT "tool_execution_operatorRunStepId_fkey"
    FOREIGN KEY ("operatorRunStepId") REFERENCES "operator_run_step"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
