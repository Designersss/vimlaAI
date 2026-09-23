-- Strengthen SQL NULL semantics without rewriting the earlier additive migration.
ALTER TABLE semantic_source ADD CONSTRAINT semantic_source_project_scope_complete CHECK (
  (kind='PROJECT' AND "projectId" IS NOT NULL AND "projectId"="sourceId") OR
  (kind<>'PROJECT' AND "projectId" IS NULL)
);
ALTER TABLE semantic_source ADD CONSTRAINT semantic_source_lease_complete CHECK (
  (status='RUNNING' AND "leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL) OR
  (status<>'RUNNING' AND "leaseToken" IS NULL AND "leaseUntil" IS NULL)
);
ALTER TABLE semantic_source ADD CONSTRAINT semantic_source_key_consistent CHECK (
  id=kind||':'||"sourceId" AND length("sourceId") BETWEEN 1 AND 512
);
