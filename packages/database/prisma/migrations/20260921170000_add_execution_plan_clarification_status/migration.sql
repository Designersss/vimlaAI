ALTER TABLE "execution_plan"
  DROP CONSTRAINT "execution_plan_status_chk";

ALTER TABLE "execution_plan"
  ADD CONSTRAINT "execution_plan_status_chk" CHECK (
    "status" IN (
      'PLANNING',
      'NEEDS_CLARIFICATION',
      'PLANNED',
      'RUNNING',
      'PARTIAL',
      'COMPLETED',
      'FAILED',
      'CANCELED'
    )
  );
