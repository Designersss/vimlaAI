-- Authenticated 256-bit private-keyed HUMAN commitment. Never store HUMAN plaintext or bindingKey.
ALTER TABLE "direct_message" ADD COLUMN "contentCommitmentB64" TEXT;
