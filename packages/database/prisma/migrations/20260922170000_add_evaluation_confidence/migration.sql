ALTER TABLE "evaluation"
ADD COLUMN "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0;

ALTER TABLE "evaluation"
ALTER COLUMN "confidence" DROP DEFAULT;

ALTER TABLE "evaluation"
ADD CONSTRAINT "evaluation_confidence_range"
CHECK ("confidence" >= 0.0 AND "confidence" <= 1.0);
