-- Defense in depth: one grant source cannot create two buckets.
DROP INDEX "usage_bucket_sourceType_sourceId_idx";

CREATE UNIQUE INDEX "usage_bucket_sourceType_sourceId_key" ON "usage_bucket"("sourceType", "sourceId");

-- Ledger history is append-only. Corrections must be compensating inserts.
CREATE OR REPLACE FUNCTION usage_ledger_entry_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'usage_ledger_entry is append-only';
END;
$$;

CREATE TRIGGER usage_ledger_entry_no_update
  BEFORE UPDATE OR DELETE ON usage_ledger_entry
  FOR EACH ROW
  EXECUTE FUNCTION usage_ledger_entry_append_only();
