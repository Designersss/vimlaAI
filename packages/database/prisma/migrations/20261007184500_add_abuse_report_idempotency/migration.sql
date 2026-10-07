ALTER TABLE "abuse_report"
  ADD COLUMN "requestId" UUID,
  ADD COLUMN "requestFingerprint" TEXT;

-- Preserve any pre-existing development/staging rows without requiring an
-- extension-backed UUID generator. Their report id is already a UUID and is
-- unique enough to become a legacy idempotency request id.
UPDATE "abuse_report"
SET
  "requestId" = "id",
  "requestFingerprint" = 'legacy:' || "id"::text
WHERE "requestId" IS NULL;

ALTER TABLE "abuse_report"
  ALTER COLUMN "requestId" SET NOT NULL,
  ALTER COLUMN "requestFingerprint" SET NOT NULL;

CREATE UNIQUE INDEX "abuse_report_reporterUserId_requestId_key"
  ON "abuse_report"("reporterUserId", "requestId");
