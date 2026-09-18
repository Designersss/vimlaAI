ALTER TABLE "ai_provider_turn"
  DROP CONSTRAINT "ai_provider_turn_status_chk";

ALTER TABLE "ai_provider_turn"
  ADD CONSTRAINT "ai_provider_turn_status_chk" CHECK (
    "status" IN (
      'CREATED',
      'WAITING_FOR_USAGE_CAPACITY',
      'BLOCKED_INSUFFICIENT_USAGE',
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
  );
