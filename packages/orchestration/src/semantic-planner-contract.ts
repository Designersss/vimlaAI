import type { PlannerInvocationMention } from "./planner-mentions.js";
import type {
  AcceptanceCriteria,
  ExecutionPlan,
  FailurePolicy,
  InputBinding,
  InvocationDependency,
  JoinPolicy,
  OutputDeclaration,
  RiskClass,
} from "./types.js";

export const SEMANTIC_WORKFLOW_PLANNER_MARKER =
  "VIMLA_SEMANTIC_WORKFLOW_PLANNER_V1" as const;

export const SEMANTIC_PLANNER_LIMITS = {
  userTextMax: 16_000,
  clarificationMax: 1_000,
  rawOutputMax: 128_000,
  maxInvocations: 64,
  maxDependencies: 256,
  maxOutputsPerInvocation: 32,
  maxCriteriaPerInvocation: 32,
  maxBindingsPerDependency: 32,
  maxPlanningContextItems: 128,
  maxConfidence: 1,
  minPlanConfidence: 0.65,
  defaultMaxParallelism: 4,
} as const;

export type SemanticPlannerTargetHint =
  | {
      kind: "MENTION";
      occurrenceId: string;
      semanticRole: "EXECUTION" | "EVALUATION";
    }
  | { kind: "EVALUATOR" };

export interface SemanticPlannerInvocationDraft {
  id: string;
  purpose: string;
  targetHint: SemanticPlannerTargetHint;
  outputs: readonly OutputDeclaration[];
  acceptanceCriteria: readonly AcceptanceCriteria[];
  riskHint: RiskClass;
  failurePolicy: FailurePolicy;
  joinPolicy: JoinPolicy;
}

export interface SemanticPlannerDependencyDraft {
  id: string;
  fromInvocationId: string;
  toInvocationId: string;
  condition: InvocationDependency["condition"];
  inputBindings: readonly InputBinding[];
}

export type SemanticPlannerDraft =
  | {
      schemaVersion: 1;
      decision: "PLAN";
      confidence: number;
      clarificationQuestion: null;
      goal: string;
      invocations: readonly SemanticPlannerInvocationDraft[];
      dependencies: readonly SemanticPlannerDependencyDraft[];
    }
  | {
      schemaVersion: 1;
      decision: "CLARIFY";
      confidence: number;
      clarificationQuestion: string;
      goal: null;
      invocations: readonly [];
      dependencies: readonly [];
    };

export interface SemanticPlannerContextItem {
  sourceType: string;
  sourceId: string;
  sourceVersion: string | null;
  classification: string;
  contentRef: string | null;
  metadata: unknown;
}

export interface SemanticWorkflowPlannerInput {
  userText: string;
  mentions: readonly PlannerInvocationMention[];
  planningContext: readonly SemanticPlannerContextItem[];
}

export type SemanticWorkflowPlannerResult =
  | {
      kind: "PLAN";
      confidence: number;
      plan: ExecutionPlan;
    }
  | {
      kind: "CLARIFY";
      confidence: number;
      clarificationQuestion: string;
    };

export interface SemanticPlannerModel {
  complete(input: {
    prompt: string;
    correlationId: string;
    signal?: AbortSignal;
  }): Promise<string>;
}

export class SemanticPlannerError extends Error {
  constructor(
    readonly code:
      | "OUTPUT_INVALID"
      | "TARGET_RESOLUTION_FAILED"
      | "MENTION_CONSTRAINT_VIOLATION"
      | "GRAPH_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "SemanticPlannerError";
  }
}
