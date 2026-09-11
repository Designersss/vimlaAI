-- Phase 7: @Vimla operator runtime. Additive only.
-- One OPERATOR conversation per user (partial unique index).
-- Planner/tool payloads stay server-side; public API never returns inputJson.

ALTER TABLE "conversation" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'CHAT';

ALTER TABLE "conversation"
    ADD CONSTRAINT "conversation_kind_chk" CHECK ("kind" IN ('CHAT', 'OPERATOR'));

CREATE INDEX "conversation_userId_kind_idx" ON "conversation"("userId", "kind");

CREATE UNIQUE INDEX "conversation_one_operator_per_user"
    ON "conversation"("userId")
    WHERE "kind" = 'OPERATOR';

CREATE TABLE "operator_run" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userMessageId" TEXT,
    "assistantMessageId" TEXT,
    "clientRequestId" TEXT NOT NULL,
    "continueClientRequestId" TEXT,
    "plannerClientRequestId" TEXT,
    "plannerAiRequestId" TEXT,
    "status" TEXT NOT NULL,
    "userText" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "publicMessage" TEXT,
    "clarificationQuestion" TEXT,
    "confirmationTokenHash" TEXT,
    "confirmationExpiresAt" TIMESTAMP(3),
    "plannerOutput" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operator_run_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "operator_run_status_chk" CHECK (
        "status" IN (
            'CREATED',
            'PLANNING',
            'AWAITING_CLARIFICATION',
            'AWAITING_CONFIRMATION',
            'EXECUTING',
            'SUCCEEDED',
            'FAILED',
            'CANCELED',
            'PARTIAL'
        )
    )
);

CREATE UNIQUE INDEX "operator_run_userId_clientRequestId_key" ON "operator_run"("userId", "clientRequestId");
CREATE INDEX "operator_run_userId_createdAt_idx" ON "operator_run"("userId", "createdAt");
CREATE INDEX "operator_run_conversationId_createdAt_idx" ON "operator_run"("conversationId", "createdAt");
CREATE INDEX "operator_run_status_updatedAt_idx" ON "operator_run"("status", "updatedAt");

ALTER TABLE "operator_run"
    ADD CONSTRAINT "operator_run_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "operator_run"
    ADD CONSTRAINT "operator_run_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "operator_run_step" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "toolName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "inputJson" JSONB NOT NULL,
    "publicKind" TEXT NOT NULL,
    "publicTitle" TEXT NOT NULL,
    "publicDetail" TEXT,
    "publicHrefPath" TEXT,
    "objectId" TEXT,
    "errorCode" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operator_run_step_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "operator_run_step_status_chk" CHECK (
        "status" IN (
            'PENDING',
            'NEEDS_CONFIRMATION',
            'CONFIRMED',
            'EXECUTED',
            'FAILED',
            'SKIPPED'
        )
    )
);

CREATE UNIQUE INDEX "operator_run_step_runId_sequence_key" ON "operator_run_step"("runId", "sequence");
CREATE UNIQUE INDEX "operator_run_step_runId_idempotencyKey_key" ON "operator_run_step"("runId", "idempotencyKey");
CREATE INDEX "operator_run_step_runId_status_idx" ON "operator_run_step"("runId", "status");

ALTER TABLE "operator_run_step"
    ADD CONSTRAINT "operator_run_step_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "operator_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "operator_audit_event" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "objectKind" TEXT,
    "objectId" TEXT,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operator_audit_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "operator_audit_event_userId_createdAt_idx" ON "operator_audit_event"("userId", "createdAt");
CREATE INDEX "operator_audit_event_runId_createdAt_idx" ON "operator_audit_event"("runId", "createdAt");

ALTER TABLE "operator_audit_event"
    ADD CONSTRAINT "operator_audit_event_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "operator_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "operator_audit_event"
    ADD CONSTRAINT "operator_audit_event_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "message" ADD COLUMN "operatorRunId" TEXT;

CREATE INDEX "message_operatorRunId_idx" ON "message"("operatorRunId");

ALTER TABLE "message"
    ADD CONSTRAINT "message_operatorRunId_fkey"
    FOREIGN KEY ("operatorRunId") REFERENCES "operator_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_request" ADD COLUMN "outputText" TEXT;
