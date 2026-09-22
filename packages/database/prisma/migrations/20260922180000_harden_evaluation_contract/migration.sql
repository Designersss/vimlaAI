ALTER TABLE "evaluation"
  ADD CONSTRAINT "evaluation_evaluator_kind_chk" CHECK (
    "evaluatorKind" IN ('DETERMINISTIC', 'AI_EVALUATOR', 'HUMAN_APPROVAL')
  );

ALTER TABLE "evaluation"
  ADD CONSTRAINT "evaluation_outcome_chk" CHECK (
    "outcome" IN ('PASS', 'FAIL')
  );
