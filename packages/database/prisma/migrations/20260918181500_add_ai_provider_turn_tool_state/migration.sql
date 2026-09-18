ALTER TABLE "ai_provider_turn"
  ADD COLUMN "toolCallsJson" JSONB,
  ADD COLUMN "toolResultsJson" JSONB;
