import type { DependencyCondition } from "./dependencies.js";
import type { InvocationStatus, PlanStatus } from "./states.js";
import type { InvocationTarget } from "./targets.js";

export const EXECUTION_PLAN_SCHEMA_VERSION = 1 as const;

export type ArtifactType =
  | "TEXT"
  | "PROMPT"
  | "DOCUMENT"
  | "CODE"
  | "IMAGE"
  | "PLAN"
  | "FILE"
  | "PATCH"
  | "JSON";

export type EvaluationMode = "DETERMINISTIC" | "AI_EVALUATOR" | "HUMAN_APPROVAL";

export type RiskClass =
  | "READ_ONLY"
  | "INTERNAL_WRITE"
  | "EXTERNAL_SIDE_EFFECT"
  | "DESTRUCTIVE"
  | "FINANCIAL";

export type ApprovalPolicy = "AUTO" | "USER_CONFIRMATION" | "HUMAN_APPROVAL";

export type FailurePolicy = "FAIL_PLAN" | "CONTINUE";

export type JoinPolicy = "ALL_REQUIRED" | "ANY_REQUIRED" | "ALL_SETTLED";

export interface InputBinding {
  inputName: string;
  sourceOutputName: string;
  expectedArtifactType: ArtifactType;
}

export interface OutputDeclaration {
  name: string;
  artifactType: ArtifactType;
  description?: string;
}

export type DeterministicCriterionBinding =
  | {
      kind: "ARTIFACT_EXISTS";
      inputName: string;
    }
  | {
      kind: "TEXT_CONTAINS";
      inputName: string;
      value: string;
      caseSensitive?: boolean;
    }
  | {
      kind: "JSON_EQUALS";
      inputName: string;
      path: string;
      expectedValue: string | number | boolean | null;
    };

export interface AcceptanceCriteria {
  id: string;
  description: string;
  mode: EvaluationMode;
  binding?: DeterministicCriterionBinding;
}

export type EvaluationOutcome = "PASS" | "FAIL";

export interface EvaluationCriterionResult {
  criterionId: string;
  outcome: EvaluationOutcome;
  confidence: number;
  summary?: string;
}

export interface EvaluationResult {
  mode: EvaluationMode;
  outcome: EvaluationOutcome;
  confidence: number;
  criteriaResults: readonly EvaluationCriterionResult[];
  summary?: string;
}

/**
 * A graph-local workflow node. The target is deliberately provider-agnostic:
 * provider ids, provider model ids, prices, permissions and user ids do not
 * belong in the orchestration plan contract.
 */
export interface Invocation {
  id: string;
  purpose: string;
  target: InvocationTarget;
  outputs: readonly OutputDeclaration[];
  acceptanceCriteria: readonly AcceptanceCriteria[];
  riskClass: RiskClass;
  approvalPolicy: ApprovalPolicy;
  failurePolicy: FailurePolicy;
  joinPolicy: JoinPolicy;
}

export interface InvocationDependency {
  id: string;
  fromInvocationId: string;
  toInvocationId: string;
  condition: DependencyCondition;
  inputBindings: readonly InputBinding[];
}

/**
 * Immutable semantic plan definition. Runtime state is persisted separately;
 * after Start this definition must not be edited in place.
 */
export interface ExecutionPlan {
  schemaVersion: typeof EXECUTION_PLAN_SCHEMA_VERSION;
  goal: string;
  maxParallelism: number;
  invocations: readonly Invocation[];
  dependencies: readonly InvocationDependency[];
}

/**
 * Runtime-facing projections are intentionally separate from the immutable
 * plan definition. PR-02 will persist these states in PostgreSQL.
 */
export interface ExecutionPlanRuntimeState {
  planId: string;
  status: PlanStatus;
}

export interface InvocationRuntimeState {
  invocationId: string;
  status: InvocationStatus;
}
