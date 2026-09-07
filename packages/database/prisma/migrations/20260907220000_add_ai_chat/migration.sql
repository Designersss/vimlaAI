-- CreateTable
CREATE TABLE "ai_model" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerModelId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "supportsStreaming" BOOLEAN NOT NULL DEFAULT true,
    "contextWindowTokens" INTEGER NOT NULL,
    "maxOutputTokens" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_price_version" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "inputMicroRubPerMillion" BIGINT NOT NULL,
    "outputMicroRubPerMillion" BIGINT NOT NULL,
    "cacheReadMicroRubPerMillion" BIGINT,
    "cacheWriteMicroRubPerMillion" BIGINT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_model_price_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "aiRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_request" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "priceVersionId" TEXT NOT NULL,
    "reservationId" TEXT,
    "clientRequestId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerModelId" TEXT NOT NULL,
    "providerRequestId" TEXT,
    "status" TEXT NOT NULL,
    "financialStatus" TEXT NOT NULL,
    "estimatedInputTokens" INTEGER NOT NULL,
    "maxOutputTokens" INTEGER NOT NULL,
    "estimatedCostMicroRub" BIGINT NOT NULL,
    "actualInputTokens" INTEGER,
    "actualOutputTokens" INTEGER,
    "reasoningTokens" INTEGER,
    "cacheReadTokens" INTEGER,
    "cacheWriteTokens" INTEGER,
    "providerActualCostMicroRub" BIGINT,
    "userSettledUsageMicroRub" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ai_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_model_slug_key" ON "ai_model"("slug");

-- CreateIndex
CREATE INDEX "ai_model_price_version_modelId_effectiveFrom_idx" ON "ai_model_price_version"("modelId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "conversation_userId_updatedAt_idx" ON "conversation"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "message_conversationId_createdAt_idx" ON "message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "message_aiRequestId_idx" ON "message"("aiRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_request_userId_clientRequestId_key" ON "ai_request"("userId", "clientRequestId");

-- CreateIndex
CREATE INDEX "ai_request_conversationId_createdAt_idx" ON "ai_request"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_request_reservationId_idx" ON "ai_request"("reservationId");

-- CreateIndex
CREATE INDEX "ai_request_status_idx" ON "ai_request"("status");

-- AddForeignKey
ALTER TABLE "ai_model_price_version" ADD CONSTRAINT "ai_model_price_version_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ai_model"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_aiRequestId_fkey" FOREIGN KEY ("aiRequestId") REFERENCES "ai_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_request" ADD CONSTRAINT "ai_request_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_request" ADD CONSTRAINT "ai_request_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_request" ADD CONSTRAINT "ai_request_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ai_model"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_request" ADD CONSTRAINT "ai_request_priceVersionId_fkey" FOREIGN KEY ("priceVersionId") REFERENCES "ai_model_price_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_request" ADD CONSTRAINT "ai_request_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "usage_reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_model_price_version"
    ADD CONSTRAINT "ai_model_price_version_money_non_negative"
    CHECK (
        "inputMicroRubPerMillion" >= 0
        AND "outputMicroRubPerMillion" >= 0
        AND ("cacheReadMicroRubPerMillion" IS NULL OR "cacheReadMicroRubPerMillion" >= 0)
        AND ("cacheWriteMicroRubPerMillion" IS NULL OR "cacheWriteMicroRubPerMillion" >= 0)
    );

ALTER TABLE "message"
    ADD CONSTRAINT "message_role_allowed"
    CHECK (role IN ('USER', 'ASSISTANT'));

ALTER TABLE "message"
    ADD CONSTRAINT "message_status_allowed"
    CHECK (status IN ('COMPLETE', 'STREAMING', 'FAILED'));

ALTER TABLE "ai_request"
    ADD CONSTRAINT "ai_request_status_allowed"
    CHECK (status IN (
        'CREATED',
        'RESERVED',
        'PROVIDER_STARTED',
        'STREAMING',
        'SUCCEEDED',
        'FAILED',
        'RECONCILIATION_REQUIRED'
    ));

ALTER TABLE "ai_request"
    ADD CONSTRAINT "ai_request_financial_status_allowed"
    CHECK ("financialStatus" IN (
        'NONE',
        'RESERVED',
        'SETTLED',
        'RELEASED',
        'ANOMALY',
        'RECONCILIATION_HOLD'
    ));

ALTER TABLE "ai_request"
    ADD CONSTRAINT "ai_request_tokens_non_negative"
    CHECK (
        "estimatedInputTokens" >= 0
        AND "maxOutputTokens" > 0
        AND "estimatedCostMicroRub" >= 0
        AND ("actualInputTokens" IS NULL OR "actualInputTokens" >= 0)
        AND ("actualOutputTokens" IS NULL OR "actualOutputTokens" >= 0)
        AND ("reasoningTokens" IS NULL OR "reasoningTokens" >= 0)
        AND ("cacheReadTokens" IS NULL OR "cacheReadTokens" >= 0)
        AND ("cacheWriteTokens" IS NULL OR "cacheWriteTokens" >= 0)
        AND ("providerActualCostMicroRub" IS NULL OR "providerActualCostMicroRub" >= 0)
        AND ("userSettledUsageMicroRub" IS NULL OR "userSettledUsageMicroRub" >= 0)
    );
