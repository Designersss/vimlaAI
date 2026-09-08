-- Phase 4.5: versioned tariffs, entitlements, fee/fiscalization policies, payment economics.
-- TOPUP buckets must never expire.

ALTER TABLE "plan_version"
    ADD COLUMN "subscriptionPeriodDays" INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    ADD COLUMN "publishedAt" TIMESTAMP(3),
    ADD COLUMN "retiredAt" TIMESTAMP(3),
    ADD COLUMN "createdByUserId" TEXT;

UPDATE "plan_version"
SET "publishedAt" = "validFrom"
WHERE "publishedAt" IS NULL;

ALTER TABLE "plan_version"
    ADD CONSTRAINT "plan_version_status_allowed"
    CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
    ADD CONSTRAINT "plan_version_period_positive"
    CHECK ("subscriptionPeriodDays" > 0 AND "subscriptionPeriodDays" <= 366),
    ADD CONSTRAINT "plan_version_money_nonnegative"
    CHECK ("priceMicroRub" >= 0 AND "providerBudgetMicroRub" >= 0);

CREATE INDEX "plan_version_status_validFrom_idx" ON "plan_version"("status", "validFrom");

CREATE TABLE "plan_entitlement" (
    "id" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueKind" TEXT NOT NULL,
    "unlimited" BOOLEAN NOT NULL DEFAULT false,
    "intValue" BIGINT,
    "boolValue" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_entitlement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "plan_entitlement_kind_allowed"
        CHECK ("valueKind" IN ('COUNT', 'BYTES', 'BOOLEAN', 'TBD')),
    CONSTRAINT "plan_entitlement_shape"
        CHECK (
            ("valueKind" = 'TBD' AND "unlimited" = false AND "intValue" IS NULL AND "boolValue" IS NULL)
            OR ("valueKind" = 'BOOLEAN' AND "unlimited" = false AND "intValue" IS NULL AND "boolValue" IS NOT NULL)
            OR ("valueKind" IN ('COUNT', 'BYTES') AND (
                ("unlimited" = true AND "intValue" IS NULL AND "boolValue" IS NULL)
                OR ("unlimited" = false AND "intValue" IS NOT NULL AND "intValue" >= 0 AND "boolValue" IS NULL)
            ))
        )
);

CREATE UNIQUE INDEX "plan_entitlement_planVersionId_key_key" ON "plan_entitlement"("planVersionId", "key");
CREATE INDEX "plan_entitlement_key_idx" ON "plan_entitlement"("key");

ALTER TABLE "plan_entitlement"
    ADD CONSTRAINT "plan_entitlement_planVersionId_fkey"
    FOREIGN KEY ("planVersionId") REFERENCES "plan_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "topup_policy_version" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "minPurchaseMicroRub" BIGINT NOT NULL,
    "maxPurchaseMicroRub" BIGINT NOT NULL,
    "usageGrantRatioBps" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "sourceKind" TEXT NOT NULL DEFAULT 'BOOTSTRAP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topup_policy_version_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "topup_policy_version_status_allowed"
        CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
    CONSTRAINT "topup_policy_version_bounds"
        CHECK ("minPurchaseMicroRub" > 0 AND "maxPurchaseMicroRub" >= "minPurchaseMicroRub"),
    CONSTRAINT "topup_policy_version_ratio"
        CHECK ("usageGrantRatioBps" >= 0 AND "usageGrantRatioBps" <= 10000)
);

CREATE INDEX "topup_policy_version_status_effectiveFrom_idx" ON "topup_policy_version"("status", "effectiveFrom");

CREATE TABLE "payment_fee_policy_version" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "feeBps" INTEGER NOT NULL,
    "feeVatBps" INTEGER NOT NULL DEFAULT 0,
    "minimumFeeMicroRub" BIGINT,
    "fixedFeeMicroRub" BIGINT,
    "status" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "sourceDescription" TEXT NOT NULL,
    "sourceQuality" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_fee_policy_version_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_fee_policy_version_status_allowed"
        CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
    CONSTRAINT "payment_fee_policy_version_method_allowed"
        CHECK ("paymentMethod" IN ('CARD', 'SBP', 'T_PAY', 'OTHER')),
    CONSTRAINT "payment_fee_policy_version_quality_allowed"
        CHECK ("sourceQuality" IN ('ESTIMATE', 'UNVERIFIED', 'VERIFIED')),
    CONSTRAINT "payment_fee_policy_version_bps"
        CHECK ("feeBps" >= 0 AND "feeBps" <= 10000 AND "feeVatBps" >= 0 AND "feeVatBps" <= 10000)
);

CREATE INDEX "payment_fee_policy_lookup_idx"
    ON "payment_fee_policy_version"("provider", "paymentMethod", "status", "effectiveFrom");

CREATE TABLE "fiscalization_fee_policy_version" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "percentageBps" INTEGER,
    "fixedFeeMicroRub" BIGINT,
    "status" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "sourceDescription" TEXT NOT NULL,
    "sourceQuality" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscalization_fee_policy_version_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fiscalization_fee_policy_version_status_allowed"
        CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
    CONSTRAINT "fiscalization_fee_policy_version_quality_allowed"
        CHECK ("sourceQuality" IN ('ESTIMATE', 'UNVERIFIED', 'VERIFIED')),
    CONSTRAINT "fiscalization_fee_policy_version_bps"
        CHECK ("percentageBps" IS NULL OR ("percentageBps" >= 0 AND "percentageBps" <= 10000))
);

CREATE INDEX "fiscalization_fee_policy_lookup_idx"
    ON "fiscalization_fee_policy_version"("provider", "mode", "status", "effectiveFrom");

CREATE TABLE "tax_reserve_policy_version" (
    "id" TEXT NOT NULL,
    "reserveBps" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "sourceQuality" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_reserve_policy_version_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tax_reserve_policy_version_status_allowed"
        CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
    CONSTRAINT "tax_reserve_policy_version_bps"
        CHECK ("reserveBps" >= 0 AND "reserveBps" <= 10000)
);

CREATE INDEX "tax_reserve_policy_version_status_effectiveFrom_idx" ON "tax_reserve_policy_version"("status", "effectiveFrom");

CREATE TABLE "business_guardrail_version" (
    "id" TEXT NOT NULL,
    "targetMinimumMarginBps" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_guardrail_version_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "business_guardrail_version_status_allowed"
        CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'RETIRED'))
);

CREATE INDEX "business_guardrail_version_status_effectiveFrom_idx" ON "business_guardrail_version"("status", "effectiveFrom");

ALTER TABLE "payment"
    ADD COLUMN "topupPolicyVersionId" TEXT,
    ADD COLUMN "paymentMethod" TEXT,
    ADD COLUMN "rawProviderPaymentMethod" TEXT;

ALTER TABLE "payment"
    ADD CONSTRAINT "payment_method_allowed"
    CHECK ("paymentMethod" IS NULL OR "paymentMethod" IN ('CARD', 'SBP', 'T_PAY', 'OTHER', 'UNKNOWN'));

ALTER TABLE "payment"
    ADD CONSTRAINT "payment_topupPolicyVersionId_fkey"
    FOREIGN KEY ("topupPolicyVersionId") REFERENCES "topup_policy_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "payment_kind_status_createdAt_idx" ON "payment"("kind", "status", "createdAt");
CREATE INDEX "payment_planVersionId_createdAt_idx" ON "payment"("planVersionId", "createdAt");

CREATE TABLE "payment_economics" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "grossAmountMicroRub" BIGINT NOT NULL,
    "paymentMethod" TEXT,
    "paymentFeePolicyVersionId" TEXT,
    "estimatedAcquiringFeeMicroRub" BIGINT,
    "estimatedAcquiringFeeVatMicroRub" BIGINT,
    "fiscalizationFeePolicyVersionId" TEXT,
    "estimatedFiscalizationFeeMicroRub" BIGINT,
    "actualAcquiringFeeMicroRub" BIGINT,
    "actualAcquiringFeeVatMicroRub" BIGINT,
    "actualFiscalizationFeeMicroRub" BIGINT,
    "refundedAmountMicroRub" BIGINT NOT NULL DEFAULT 0,
    "chargebackAmountMicroRub" BIGINT NOT NULL DEFAULT 0,
    "economicsStatus" TEXT NOT NULL,
    "financialReconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_economics_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_economics_status_allowed"
        CHECK ("economicsStatus" IN ('ACTUAL', 'ESTIMATED', 'PARTIAL', 'UNKNOWN', 'RECONCILIATION_REQUIRED')),
    CONSTRAINT "payment_economics_money_nonnegative"
        CHECK (
            "grossAmountMicroRub" >= 0
            AND "refundedAmountMicroRub" >= 0
            AND "chargebackAmountMicroRub" >= 0
        )
);

CREATE UNIQUE INDEX "payment_economics_paymentId_key" ON "payment_economics"("paymentId");
CREATE INDEX "payment_economics_economicsStatus_idx" ON "payment_economics"("economicsStatus");

ALTER TABLE "payment_economics"
    ADD CONSTRAINT "payment_economics_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "payment_economics_paymentFeePolicyVersionId_fkey"
    FOREIGN KEY ("paymentFeePolicyVersionId") REFERENCES "payment_fee_policy_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "payment_economics_fiscalizationFeePolicyVersionId_fkey"
    FOREIGN KEY ("fiscalizationFeePolicyVersionId") REFERENCES "fiscalization_fee_policy_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "variable_cost_entry" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountMicroRub" BIGINT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "quality" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variable_cost_entry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "variable_cost_entry_kind_allowed"
        CHECK ("kind" IN ('SMS', 'EMAIL', 'STORAGE', 'OTHER')),
    CONSTRAINT "variable_cost_entry_quality_allowed"
        CHECK ("quality" IN ('ACTUAL', 'ESTIMATED', 'PARTIAL', 'UNKNOWN')),
    CONSTRAINT "variable_cost_entry_amount_nonnegative"
        CHECK ("amountMicroRub" >= 0)
);

CREATE INDEX "variable_cost_entry_kind_occurredAt_idx" ON "variable_cost_entry"("kind", "occurredAt");
CREATE INDEX "variable_cost_entry_sourceType_sourceId_idx" ON "variable_cost_entry"("sourceType", "sourceId");

CREATE INDEX "ai_request_createdAt_idx" ON "ai_request"("createdAt");

ALTER TABLE "usage_bucket"
    ADD CONSTRAINT "usage_bucket_topup_never_expires"
    CHECK (type <> 'TOPUP' OR "expiresAt" IS NULL);

-- Published commercial rows are immutable except retirement timestamps/status.
CREATE OR REPLACE FUNCTION reject_published_commercial_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'plan_version' THEN
    IF OLD.status <> 'DRAFT' AND (
      NEW."priceMicroRub" IS DISTINCT FROM OLD."priceMicroRub"
      OR NEW."providerBudgetMicroRub" IS DISTINCT FROM OLD."providerBudgetMicroRub"
      OR NEW."providerCostRatioBps" IS DISTINCT FROM OLD."providerCostRatioBps"
      OR NEW."subscriptionPeriodDays" IS DISTINCT FROM OLD."subscriptionPeriodDays"
      OR NEW."validFrom" IS DISTINCT FROM OLD."validFrom"
    ) THEN
      RAISE EXCEPTION 'published plan_version commercial fields are immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'topup_policy_version' THEN
    IF OLD.status <> 'DRAFT' AND (
      NEW."minPurchaseMicroRub" IS DISTINCT FROM OLD."minPurchaseMicroRub"
      OR NEW."maxPurchaseMicroRub" IS DISTINCT FROM OLD."maxPurchaseMicroRub"
      OR NEW."usageGrantRatioBps" IS DISTINCT FROM OLD."usageGrantRatioBps"
      OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom"
    ) THEN
      RAISE EXCEPTION 'published topup_policy_version commercial fields are immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'payment_fee_policy_version' THEN
    IF OLD.status <> 'DRAFT' AND (
      NEW."feeBps" IS DISTINCT FROM OLD."feeBps"
      OR NEW."feeVatBps" IS DISTINCT FROM OLD."feeVatBps"
      OR NEW."minimumFeeMicroRub" IS DISTINCT FROM OLD."minimumFeeMicroRub"
      OR NEW."fixedFeeMicroRub" IS DISTINCT FROM OLD."fixedFeeMicroRub"
      OR NEW."paymentMethod" IS DISTINCT FROM OLD."paymentMethod"
      OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom"
    ) THEN
      RAISE EXCEPTION 'published payment_fee_policy_version commercial fields are immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'fiscalization_fee_policy_version' THEN
    IF OLD.status <> 'DRAFT' AND (
      NEW."percentageBps" IS DISTINCT FROM OLD."percentageBps"
      OR NEW."fixedFeeMicroRub" IS DISTINCT FROM OLD."fixedFeeMicroRub"
      OR NEW."mode" IS DISTINCT FROM OLD."mode"
      OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom"
    ) THEN
      RAISE EXCEPTION 'published fiscalization_fee_policy_version commercial fields are immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'tax_reserve_policy_version' THEN
    IF OLD.status <> 'DRAFT' AND (
      NEW."reserveBps" IS DISTINCT FROM OLD."reserveBps"
      OR NEW."enabled" IS DISTINCT FROM OLD."enabled"
      OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom"
    ) THEN
      RAISE EXCEPTION 'published tax_reserve_policy_version commercial fields are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER plan_version_published_immutable
  BEFORE UPDATE ON "plan_version"
  FOR EACH ROW
  EXECUTE FUNCTION reject_published_commercial_update();

CREATE TRIGGER topup_policy_version_published_immutable
  BEFORE UPDATE ON "topup_policy_version"
  FOR EACH ROW
  EXECUTE FUNCTION reject_published_commercial_update();

CREATE TRIGGER payment_fee_policy_version_published_immutable
  BEFORE UPDATE ON "payment_fee_policy_version"
  FOR EACH ROW
  EXECUTE FUNCTION reject_published_commercial_update();

CREATE TRIGGER fiscalization_fee_policy_version_published_immutable
  BEFORE UPDATE ON "fiscalization_fee_policy_version"
  FOR EACH ROW
  EXECUTE FUNCTION reject_published_commercial_update();

CREATE TRIGGER tax_reserve_policy_version_published_immutable
  BEFORE UPDATE ON "tax_reserve_policy_version"
  FOR EACH ROW
  EXECUTE FUNCTION reject_published_commercial_update();

CREATE OR REPLACE FUNCTION reject_plan_entitlement_on_published_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_status TEXT;
BEGIN
  SELECT status INTO version_status FROM "plan_version" WHERE id = COALESCE(NEW."planVersionId", OLD."planVersionId");
  IF version_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'plan entitlements are immutable after the plan version is published';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER plan_entitlement_published_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON "plan_entitlement"
  FOR EACH ROW
  EXECUTE FUNCTION reject_plan_entitlement_on_published_version();
