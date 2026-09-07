-- CreateTable
CREATE TABLE "plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_version" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "priceMicroRub" BIGINT NOT NULL,
    "providerBudgetMicroRub" BIGINT NOT NULL,
    "providerCostRatioBps" INTEGER NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerPaymentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountMicroRub" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "status" TEXT NOT NULL,
    "planVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_event" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_bucket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "totalMicroRub" BIGINT NOT NULL,
    "spentMicroRub" BIGINT NOT NULL DEFAULT 0,
    "reservedMicroRub" BIGINT NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_bucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_reservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "estimatedMicroRub" BIGINT NOT NULL,
    "settledMicroRub" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "usage_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_reservation_allocation" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "bucketId" TEXT NOT NULL,
    "reservedMicroRub" BIGINT NOT NULL,
    "settledMicroRub" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "usage_reservation_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_ledger_entry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bucketId" TEXT,
    "reservationId" TEXT,
    "paymentId" TEXT,
    "type" TEXT NOT NULL,
    "amountMicroRub" BIGINT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_code_key" ON "plan"("code");

-- CreateIndex
CREATE INDEX "plan_version_planId_validFrom_idx" ON "plan_version"("planId", "validFrom");

-- CreateIndex
CREATE INDEX "subscription_userId_status_idx" ON "subscription"("userId", "status");

-- CreateIndex
CREATE INDEX "subscription_planVersionId_idx" ON "subscription"("planVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_one_active_per_user" ON "subscription"("userId") WHERE status = 'ACTIVE';

-- CreateIndex
CREATE UNIQUE INDEX "payment_provider_providerPaymentId_key" ON "payment"("provider", "providerPaymentId");

-- CreateIndex
CREATE INDEX "payment_userId_createdAt_idx" ON "payment"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_event_provider_providerEventId_key" ON "payment_event"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "payment_event_paymentId_idx" ON "payment_event"("paymentId");

-- CreateIndex
CREATE INDEX "usage_bucket_userId_type_expiresAt_idx" ON "usage_bucket"("userId", "type", "expiresAt");

-- CreateIndex
CREATE INDEX "usage_bucket_sourceType_sourceId_idx" ON "usage_bucket"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "usage_reservation_userId_requestId_key" ON "usage_reservation"("userId", "requestId");

-- CreateIndex
CREATE INDEX "usage_reservation_userId_status_idx" ON "usage_reservation"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "usage_reservation_allocation_reservationId_bucketId_key" ON "usage_reservation_allocation"("reservationId", "bucketId");

-- CreateIndex
CREATE INDEX "usage_reservation_allocation_bucketId_idx" ON "usage_reservation_allocation"("bucketId");

-- CreateIndex
CREATE INDEX "usage_ledger_entry_userId_createdAt_idx" ON "usage_ledger_entry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "usage_ledger_entry_bucketId_idx" ON "usage_ledger_entry"("bucketId");

-- CreateIndex
CREATE INDEX "usage_ledger_entry_reservationId_idx" ON "usage_ledger_entry"("reservationId");

-- AddForeignKey
ALTER TABLE "plan_version" ADD CONSTRAINT "plan_version_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "plan_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "plan_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_bucket" ADD CONSTRAINT "usage_bucket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_reservation" ADD CONSTRAINT "usage_reservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_reservation_allocation" ADD CONSTRAINT "usage_reservation_allocation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "usage_reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_reservation_allocation" ADD CONSTRAINT "usage_reservation_allocation_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "usage_bucket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_ledger_entry" ADD CONSTRAINT "usage_ledger_entry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_ledger_entry" ADD CONSTRAINT "usage_ledger_entry_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "usage_bucket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_ledger_entry" ADD CONSTRAINT "usage_ledger_entry_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "usage_reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_ledger_entry" ADD CONSTRAINT "usage_ledger_entry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financial CHECK constraints. Prisma cannot express these; they are the last line of defense.

ALTER TABLE "plan_version"
    ADD CONSTRAINT "plan_version_money_non_negative"
    CHECK ("priceMicroRub" >= 0 AND "providerBudgetMicroRub" >= 0 AND "providerCostRatioBps" >= 0 AND "providerCostRatioBps" <= 10000);

ALTER TABLE "subscription"
    ADD CONSTRAINT "subscription_status_allowed"
    CHECK (status IN ('ACTIVE', 'CANCELED', 'EXPIRED'));

ALTER TABLE "payment"
    ADD CONSTRAINT "payment_amount_non_negative"
    CHECK ("amountMicroRub" >= 0);

ALTER TABLE "payment"
    ADD CONSTRAINT "payment_kind_allowed"
    CHECK (kind IN ('SUBSCRIPTION', 'TOPUP'));

ALTER TABLE "payment"
    ADD CONSTRAINT "payment_status_allowed"
    CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'));

ALTER TABLE "usage_bucket"
    ADD CONSTRAINT "usage_bucket_type_allowed"
    CHECK (type IN ('MONTHLY', 'TOPUP'));

ALTER TABLE "usage_bucket"
    ADD CONSTRAINT "usage_bucket_non_negative"
    CHECK ("totalMicroRub" >= 0 AND "spentMicroRub" >= 0 AND "reservedMicroRub" >= 0);

ALTER TABLE "usage_bucket"
    ADD CONSTRAINT "usage_bucket_capacity"
    CHECK ("spentMicroRub" + "reservedMicroRub" <= "totalMicroRub");

ALTER TABLE "usage_reservation"
    ADD CONSTRAINT "usage_reservation_status_allowed"
    CHECK (status IN ('ACTIVE', 'SETTLED', 'RELEASED', 'ANOMALY'));

ALTER TABLE "usage_reservation"
    ADD CONSTRAINT "usage_reservation_money_non_negative"
    CHECK ("estimatedMicroRub" >= 0 AND "settledMicroRub" >= 0);

ALTER TABLE "usage_reservation_allocation"
    ADD CONSTRAINT "usage_reservation_allocation_money"
    CHECK ("reservedMicroRub" >= 0 AND "settledMicroRub" >= 0 AND "settledMicroRub" <= "reservedMicroRub");
