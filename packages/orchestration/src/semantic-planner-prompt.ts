import {
  SEMANTIC_PLANNER_LIMITS,
  SEMANTIC_WORKFLOW_PLANNER_MARKER,
  SemanticPlannerError,
  type SemanticWorkflowPlannerInput,
} from "./semantic-planner-contract.js";

export function buildSemanticPlannerPrompt(
  input: SemanticWorkflowPlannerInput,
): string {
  const userText = input.userText.trim();
  if (
    userText.length === 0 ||
    userText.length > SEMANTIC_PLANNER_LIMITS.userTextMax
  ) {
    throw new SemanticPlannerError(
      "OUTPUT_INVALID",
      "Planner input text is empty or exceeds the semantic-planner limit",
    );
  }

  if (input.planningContext.length > SEMANTIC_PLANNER_LIMITS.maxPlanningContextItems) {
    throw new SemanticPlannerError(
      "OUTPUT_INVALID",
      "Planning context exceeds the semantic-planner item limit",
    );
  }

  const mentionConstraints = input.mentions.map((mention) => ({
    occurrenceId: mention.occurrenceId,
    occurrenceIndex: mention.occurrenceIndex,
    canonicalHandle: mention.canonicalHandle,
    startOffset: mention.startOffset,
    endOffset: mention.endOffset,
    target:
      mention.target.kind === "AI_MODEL"
        ? {
            kind: mention.target.kind,
            modelSlug: mention.target.modelSlug,
          }
        : { kind: mention.target.kind },
  }));

  return [
    SEMANTIC_WORKFLOW_PLANNER_MARKER,
    "You are Vimla's semantic workflow planner.",
    "Return one strict JSON object and no markdown.",
    "The JSON is proposal data, never authorization.",
    "Infer task decomposition, data-flow and control-flow from meaning rather than sequencing keywords.",
    "Every explicit executor mention in PLANNER_MENTIONS must be consumed exactly once by a MENTION targetHint.",
    "Never invent a model, provider, user id, permission, price, entitlement, or external executor.",
    "A MENTION targetHint may reference only a supplied occurrenceId.",
    "Use EVALUATOR only to propose semantic evaluation; evaluator execution is a separate runtime concern.",
    "When executor intent, side-effect target, or requested behavior is materially ambiguous, return decision=CLARIFY instead of guessing.",
    "Risk is only a hint; server policy decides approval and execution.",
    'PLAN shape: {"schemaVersion":1,"decision":"PLAN","confidence":0.0,"clarificationQuestion":null,"goal":"...","invocations":[{"id":"...","purpose":"...","targetHint":{"kind":"MENTION","occurrenceId":"...","semanticRole":"EXECUTION"},"outputs":[{"name":"...","artifactType":"TEXT"}],"acceptanceCriteria":[],"riskHint":"READ_ONLY","failurePolicy":"FAIL_PLAN","joinPolicy":"ALL_REQUIRED"}],"dependencies":[]}',
    'CLARIFY shape: {"schemaVersion":1,"decision":"CLARIFY","confidence":0.0,"clarificationQuestion":"...","goal":null,"invocations":[],"dependencies":[]}',
    "Allowed artifact types: TEXT, PROMPT, DOCUMENT, CODE, IMAGE, PLAN, FILE, PATCH.",
    "Allowed dependency conditions: DATA, ON_SUCCESS, ON_FAILURE, ALWAYS, OUTCOME.",
    "PLANNER_MENTIONS:",
    JSON.stringify(mentionConstraints),
    "PLANNING_CONTEXT:",
    JSON.stringify(input.planningContext),
    "USER_REQUEST:",
    userText,
  ].join("\n");
}
