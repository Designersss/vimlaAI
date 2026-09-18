ALTER TABLE "invocation"
  DROP CONSTRAINT "invocation_status_chk";

ALTER TABLE "invocation"
  ADD CONSTRAINT "invocation_status_chk" CHECK (
    "status" IN (
      'PENDING',
      'READY',
      'RUNNING',
      'WAITING_APPROVAL',
      'WAITING_FOR_USAGE_CAPACITY',
      'BLOCKED_INSUFFICIENT_USAGE',
      'COMPLETED',
      'FAILED',
      'SKIPPED',
      'CANCELED'
    )
  );

ALTER TABLE "invocation_run"
  DROP CONSTRAINT "invocation_run_status_chk";

ALTER TABLE "invocation_run"
  ADD CONSTRAINT "invocation_run_status_chk" CHECK (
    "status" IN (
      'CREATED',
      'RUNNING',
      'WAITING_FOR_USAGE_CAPACITY',
      'BLOCKED_INSUFFICIENT_USAGE',
      'COMPLETED',
      'FAILED',
      'CANCELED'
    )
  );
