ALTER TABLE "context_snapshot"
  ALTER COLUMN "planId" DROP NOT NULL,
  ADD COLUMN "operatorRunId" TEXT;

CREATE UNIQUE INDEX "context_snapshot_operatorRunId_key"
  ON "context_snapshot"("operatorRunId");

ALTER TABLE "context_snapshot"
  ADD CONSTRAINT "context_snapshot_operatorRunId_fkey"
  FOREIGN KEY ("operatorRunId") REFERENCES "operator_run"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "context_snapshot"
  ADD CONSTRAINT "context_snapshot_exactly_one_owner_check"
  CHECK (
    (CASE WHEN "planId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "operatorRunId" IS NOT NULL THEN 1 ELSE 0 END) = 1
  );
