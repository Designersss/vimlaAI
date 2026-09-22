ALTER TABLE "evaluation"
  ADD COLUMN "inputFingerprint" TEXT;

ALTER TABLE "evaluation"
  ADD CONSTRAINT "evaluation_input_fingerprint_chk" CHECK (
    "inputFingerprint" IS NULL OR
    "inputFingerprint" ~ '^sha256:[0-9a-f]{64}$'
  );
