ALTER TABLE "artifact"
  DROP CONSTRAINT "artifact_type_chk";

ALTER TABLE "artifact"
  ADD CONSTRAINT "artifact_type_chk" CHECK (
    "type" IN (
      'TEXT',
      'PROMPT',
      'DOCUMENT',
      'CODE',
      'IMAGE',
      'PLAN',
      'FILE',
      'PATCH',
      'JSON'
    )
  );
