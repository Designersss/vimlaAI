-- Phase 4: hosted checkout snapshots, provider order identity, expanded payment states.

ALTER TABLE "payment"
    ADD COLUMN "billingSubjectType" TEXT NOT NULL DEFAULT 'USER',
    ADD COLUMN "providerOrderId" TEXT,
    ADD COLUMN "providerStatus" TEXT,
    ADD COLUMN "paymentUrl" TEXT,
    ADD COLUMN "idempotencyKey" TEXT,
    ADD COLUMN "checkoutSnapshot" JSONB,
    ADD COLUMN "grantedBucketId" TEXT,
    ADD COLUMN "grantedSubscriptionId" TEXT,
    ADD COLUMN "fulfilledAt" TIMESTAMP(3);

UPDATE "payment"
SET
    "providerOrderId" = "id",
    "idempotencyKey" = "id",
    "checkoutSnapshot" = jsonb_build_object(
        'billingSubjectType', 'USER',
        'kind', kind,
        'customerPaymentAmountMicroRub', "amountMicroRub"::text,
        'providerBudgetGrantMicroRub', "amountMicroRub"::text
    );

ALTER TABLE "payment"
    ALTER COLUMN "providerOrderId" SET NOT NULL,
    ALTER COLUMN "idempotencyKey" SET NOT NULL,
    ALTER COLUMN "checkoutSnapshot" SET NOT NULL,
    ALTER COLUMN "providerPaymentId" DROP NOT NULL;

CREATE UNIQUE INDEX "payment_providerOrderId_key" ON "payment"("providerOrderId");
CREATE UNIQUE INDEX "payment_userId_kind_idempotencyKey_key" ON "payment"("userId", "kind", "idempotencyKey");
CREATE INDEX "payment_status_updatedAt_idx" ON "payment"("status", "updatedAt");

ALTER TABLE "payment" DROP CONSTRAINT "payment_status_allowed";
ALTER TABLE "payment"
    ADD CONSTRAINT "payment_status_allowed"
    CHECK (status IN (
        'CREATED',
        'PENDING',
        'SUCCEEDED',
        'FAILED',
        'CANCELED',
        'REFUNDED',
        'PARTIALLY_REFUNDED',
        'RECONCILIATION_REQUIRED'
    ));

ALTER TABLE "payment"
    ADD CONSTRAINT "payment_billing_subject_allowed"
    CHECK ("billingSubjectType" IN ('USER'));

ALTER TABLE "payment_event"
    ADD COLUMN "providerStatus" TEXT,
    ADD COLUMN "sanitizedPayload" JSONB;
