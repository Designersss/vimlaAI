-- Additive external-AI provider-turn provenance for tool-using orchestration.
-- Existing ai_execution.aiRequestId remains the compatibility pointer to the first/primary AiRequest.

CREATE TABLE "ai_provider_turn" (
    "id" TEXT NOT NULL,
    "aiExecutionId" TEXT NOT NULL,
    "turnIndex" INTEGER NOT NULL,
    "aiRequestId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_turn_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_provider_turn_turnIndex_chk" CHECK ("turnIndex" >= 0),
    CONSTRAINT "ai_provider_turn_status_chk" CHECK (
        "status" IN (
            'CREATED',
            'RESERVED',
            'PROVIDER_STARTING',
            'PROVIDER_IN_FLIGHT',
            'USAGE_DURABLE',
            'SETTLING',
            'SUCCEEDED',
            'FAILED_PRE_PROVIDER',
            'FAILED_SAFE_PROVIDER',
            'RECONCILIATION_REQUIRED',
            'CANCELED'
        )
    )
);

CREATE UNIQUE INDEX "ai_provider_turn_aiRequestId_key"
    ON "ai_provider_turn"("aiRequestId");
CREATE UNIQUE INDEX "ai_provider_turn_idempotencyKey_key"
    ON "ai_provider_turn"("idempotencyKey");
CREATE UNIQUE INDEX "ai_provider_turn_aiExecutionId_turnIndex_key"
    ON "ai_provider_turn"("aiExecutionId", "turnIndex");
CREATE INDEX "ai_provider_turn_aiExecutionId_status_idx"
    ON "ai_provider_turn"("aiExecutionId", "status");
CREATE INDEX "ai_provider_turn_status_updatedAt_idx"
    ON "ai_provider_turn"("status", "updatedAt");

ALTER TABLE "ai_provider_turn"
    ADD CONSTRAINT "ai_provider_turn_aiExecutionId_fkey"
    FOREIGN KEY ("aiExecutionId") REFERENCES "ai_execution"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_provider_turn"
    ADD CONSTRAINT "ai_provider_turn_aiRequestId_fkey"
    FOREIGN KEY ("aiRequestId") REFERENCES "ai_request"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
