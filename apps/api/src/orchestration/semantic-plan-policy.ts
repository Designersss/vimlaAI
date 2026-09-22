import type { ExecutionPlan } from "@vimla/orchestration";

const SUPPORTED_AI_OUTPUT_TYPES = new Set<string>([
  "TEXT",
  "PROMPT",
  "DOCUMENT",
  "CODE",
  "PLAN",
  "PATCH",
] as const);

export class SemanticPlanPolicyError extends Error {
  constructor(
    readonly code:
      | "TARGET_NOT_EXECUTABLE"
      | "OUTPUT_NOT_EXECUTABLE"
      | "SIDE_EFFECT_NOT_EXECUTABLE"
      | "EVALUATOR_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "SemanticPlanPolicyError";
  }
}

/**
 * Applies server-authoritative execution policy to a planner proposal.
 *
 * Planner risk is advisory only. This function owns the persisted risk and
 * approval policy for the currently implemented executors.
 */
export function applySemanticPlanExecutionPolicy(
  plan: ExecutionPlan,
): ExecutionPlan {
  return {
    ...plan,
    invocations: plan.invocations.map((invocation) => {
      switch (invocation.target.kind) {
        case "VIMLA": {
          if (invocation.outputs.length > 0) {
            throw new SemanticPlanPolicyError(
              "OUTPUT_NOT_EXECUTABLE",
              "Vimla actions cannot declare workflow artifacts yet",
            );
          }
          return {
            ...invocation,
            riskClass: "INTERNAL_WRITE" as const,
            approvalPolicy: "USER_CONFIRMATION" as const,
          };
        }

        case "AI_AUTO":
        case "AI_MODEL": {
          if (invocation.riskClass !== "READ_ONLY") {
            throw new SemanticPlanPolicyError(
              "SIDE_EFFECT_NOT_EXECUTABLE",
              "External AI side effects are not enabled for semantic workflows",
            );
          }
          if (invocation.outputs.length !== 1) {
            throw new SemanticPlanPolicyError(
              "OUTPUT_NOT_EXECUTABLE",
              "External AI invocations must declare exactly one output",
            );
          }
          const output = invocation.outputs[0];
          if (!output || !SUPPORTED_AI_OUTPUT_TYPES.has(output.artifactType)) {
            throw new SemanticPlanPolicyError(
              "OUTPUT_NOT_EXECUTABLE",
              "The selected AI executor cannot emit this artifact type yet",
            );
          }
          return {
            ...invocation,
            riskClass: "READ_ONLY" as const,
            approvalPolicy: "AUTO" as const,
          };
        }

        case "EVALUATOR": {
          if (invocation.outputs.length !== 1 || invocation.outputs[0]?.artifactType !== "JSON") {
            throw new SemanticPlanPolicyError(
              "OUTPUT_NOT_EXECUTABLE",
              "Evaluator invocations must declare exactly one JSON outcome artifact",
            );
          }
          if (invocation.acceptanceCriteria.length === 0) {
            throw new SemanticPlanPolicyError(
              "EVALUATOR_INVALID",
              "Evaluator invocations require at least one acceptance criterion",
            );
          }
          const modes = new Set(invocation.acceptanceCriteria.map((criterion) => criterion.mode));
          if (modes.size !== 1) {
            throw new SemanticPlanPolicyError(
              "EVALUATOR_INVALID",
              "One evaluator invocation cannot mix evaluation modes",
            );
          }
          const mode = invocation.acceptanceCriteria[0]?.mode;
          if (
            mode === "HUMAN_APPROVAL" &&
            invocation.acceptanceCriteria.length !== 1
          ) {
            throw new SemanticPlanPolicyError(
              "EVALUATOR_INVALID",
              "Human evaluator invocations require exactly one acceptance criterion in v1",
            );
          }
          if (
            mode === "DETERMINISTIC" &&
            invocation.acceptanceCriteria.some((criterion) => criterion.binding === undefined)
          ) {
            throw new SemanticPlanPolicyError(
              "EVALUATOR_INVALID",
              "Deterministic evaluator criteria require explicit artifact bindings",
            );
          }
          if (
            mode !== "DETERMINISTIC" &&
            invocation.acceptanceCriteria.some((criterion) => criterion.binding !== undefined)
          ) {
            throw new SemanticPlanPolicyError(
              "EVALUATOR_INVALID",
              "Only deterministic evaluator criteria may declare deterministic bindings",
            );
          }
          return {
            ...invocation,
            riskClass: "READ_ONLY" as const,
            approvalPolicy:
              mode === "HUMAN_APPROVAL"
                ? ("HUMAN_APPROVAL" as const)
                : ("AUTO" as const),
          };
        }

        case "AGENT":
          throw new SemanticPlanPolicyError(
            "TARGET_NOT_EXECUTABLE",
            "Agent execution is not available",
          );
      }
    }),
  };
}
