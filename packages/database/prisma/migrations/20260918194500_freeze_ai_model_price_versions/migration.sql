CREATE OR REPLACE FUNCTION "ai_model_price_version_immutable_fields"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."modelId" IS DISTINCT FROM OLD."modelId"
     OR NEW."inputMicroRubPerMillion" IS DISTINCT FROM OLD."inputMicroRubPerMillion"
     OR NEW."outputMicroRubPerMillion" IS DISTINCT FROM OLD."outputMicroRubPerMillion"
     OR NEW."cacheReadMicroRubPerMillion" IS DISTINCT FROM OLD."cacheReadMicroRubPerMillion"
     OR NEW."cacheWriteMicroRubPerMillion" IS DISTINCT FROM OLD."cacheWriteMicroRubPerMillion"
     OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom"
     OR NEW."verifiedAt" IS DISTINCT FROM OLD."verifiedAt"
     OR NEW."source" IS DISTINCT FROM OLD."source"
  THEN
    RAISE EXCEPTION 'ai_model_price_version commercial fields are immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_model_price_version_immutable_fields_trg"
BEFORE UPDATE ON "ai_model_price_version"
FOR EACH ROW
EXECUTE FUNCTION "ai_model_price_version_immutable_fields"();
