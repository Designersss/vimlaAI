import type { DependencyCondition } from "./dependencies.js";
import type { InvocationTarget } from "./targets.js";
import { EXECUTION_PLAN_SCHEMA_VERSION } from "./types.js";
import type {
  AcceptanceCriteria,
  ApprovalPolicy,
  ArtifactType,
  EvaluationMode,
  ExecutionPlan,
  FailurePolicy,
  InputBinding,
  Invocation,
  InvocationDependency,
  JoinPolicy,
  OutputDeclaration,
  RiskClass,
} from "./types.js";

export class ExecutionPlanSchemaError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "ExecutionPlanSchemaError";
  }
}

export type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: ExecutionPlanSchemaError };

export interface RuntimeSchema<T> {
  parse(input: unknown): T;
  safeParse(input: unknown): SafeParseResult<T>;
}

type UnknownRecord = Record<string, unknown>;
type Parser<T> = (input: unknown, path: string) => T;

const ARTIFACT_TYPES = ["TEXT", "PROMPT", "DOCUMENT", "CODE", "IMAGE", "PLAN", "FILE", "PATCH"] as const;
const EVALUATION_MODES = ["DETERMINISTIC", "AI_EVALUATOR", "HUMAN_APPROVAL"] as const;
const RISK_CLASSES = ["READ_ONLY", "INTERNAL_WRITE", "EXTERNAL_SIDE_EFFECT", "DESTRUCTIVE", "FINANCIAL"] as const;
const APPROVAL_POLICIES = ["AUTO", "USER_CONFIRMATION", "HUMAN_APPROVAL"] as const;
const FAILURE_POLICIES = ["FAIL_PLAN", "CONTINUE"] as const;
const JOIN_POLICIES = ["ALL_REQUIRED", "ANY_REQUIRED", "ALL_SETTLED"] as const;

function createRuntimeSchema<T>(parser: Parser<T>): RuntimeSchema<T> {
  return {
    parse(input: unknown): T {
      return parser(input, "$input");
    },
    safeParse(input: unknown): SafeParseResult<T> {
      try {
        return { success: true, data: parser(input, "$input") };
      } catch (error: unknown) {
        if (error instanceof ExecutionPlanSchemaError) {
          return { success: false, error };
        }
        const message = error instanceof Error ? error.message : "Unknown schema error";
        return { success: false, error: new ExecutionPlanSchemaError(message, "$input") };
      }
    },
  };
}

function parseRecord(input: unknown, path: string): UnknownRecord {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ExecutionPlanSchemaError("expected object", path);
  }
  return input as UnknownRecord;
}

function assertExactKeys(value: UnknownRecord, allowedKeys: readonly string[], path: string): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ExecutionPlanSchemaError(`unknown field ${JSON.stringify(key)}`, path);
    }
  }
}

function parseNonEmptyString(input: unknown, path: string): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new ExecutionPlanSchemaError("expected non-empty string", path);
  }
  return input.trim();
}

function parsePositiveInteger(input: unknown, path: string): number {
  if (typeof input !== "number" || !Number.isInteger(input) || input <= 0) {
    throw new ExecutionPlanSchemaError("expected positive integer", path);
  }
  return input;
}

function parseLiteralOne(input: unknown, path: string): typeof EXECUTION_PLAN_SCHEMA_VERSION {
  if (input !== EXECUTION_PLAN_SCHEMA_VERSION) {
    throw new ExecutionPlanSchemaError(`expected schema version ${EXECUTION_PLAN_SCHEMA_VERSION}`, path);
  }
  return EXECUTION_PLAN_SCHEMA_VERSION;
}

function parseEnum<T extends string>(input: unknown, values: readonly T[], path: string): T {
  if (typeof input !== "string" || !values.includes(input as T)) {
    throw new ExecutionPlanSchemaError(`expected one of ${values.join(", ")}`, path);
  }
  return input as T;
}

function parseArray<T>(input: unknown, parser: Parser<T>, path: string): T[] {
  if (!Array.isArray(input)) {
    throw new ExecutionPlanSchemaError("expected array", path);
  }
  return input.map((item, index) => parser(item, `${path}[${index}]`));
}

function parseArtifactType(input: unknown, path: string): ArtifactType {
  return parseEnum(input, ARTIFACT_TYPES, path);
}

function parseEvaluationMode(input: unknown, path: string): EvaluationMode {
  return parseEnum(input, EVALUATION_MODES, path);
}

function parseRiskClass(input: unknown, path: string): RiskClass {
  return parseEnum(input, RISK_CLASSES, path);
}

function parseApprovalPolicy(input: unknown, path: string): ApprovalPolicy {
  return parseEnum(input, APPROVAL_POLICIES, path);
}

function parseFailurePolicy(input: unknown, path: string): FailurePolicy {
  return parseEnum(input, FAILURE_POLICIES, path);
}

function parseJoinPolicy(input: unknown, path: string): JoinPolicy {
  return parseEnum(input, JOIN_POLICIES, path);
}

function parseInvocationTarget(input: unknown, path: string): InvocationTarget {
  const value = parseRecord(input, path);
  const kind = parseNonEmptyString(value.kind, `${path}.kind`);

  switch (kind) {
    case "VIMLA":
    case "AI_AUTO":
    case "EVALUATOR":
      assertExactKeys(value, ["kind"], path);
      return { kind };
    case "AI_MODEL":
      assertExactKeys(value, ["kind", "modelSlug"], path);
      return { kind, modelSlug: parseNonEmptyString(value.modelSlug, `${path}.modelSlug`) };
    case "AGENT":
      assertExactKeys(value, ["kind", "agentId"], path);
      return { kind, agentId: parseNonEmptyString(value.agentId, `${path}.agentId`) };
    default:
      throw new ExecutionPlanSchemaError("unknown invocation target kind", `${path}.kind`);
  }
}

function parseDependencyCondition(input: unknown, path: string): DependencyCondition {
  const value = parseRecord(input, path);
  const kind = parseNonEmptyString(value.kind, `${path}.kind`);

  switch (kind) {
    case "DATA":
    case "ON_SUCCESS":
    case "ON_FAILURE":
    case "ALWAYS":
      assertExactKeys(value, ["kind"], path);
      return { kind };
    case "OUTCOME":
      assertExactKeys(value, ["kind", "outcome"], path);
      return { kind, outcome: parseNonEmptyString(value.outcome, `${path}.outcome`) };
    default:
      throw new ExecutionPlanSchemaError("unknown dependency condition kind", `${path}.kind`);
  }
}

function parseInputBinding(input: unknown, path: string): InputBinding {
  const value = parseRecord(input, path);
  assertExactKeys(value, ["inputName", "sourceOutputName", "expectedArtifactType"], path);
  return {
    inputName: parseNonEmptyString(value.inputName, `${path}.inputName`),
    sourceOutputName: parseNonEmptyString(value.sourceOutputName, `${path}.sourceOutputName`),
    expectedArtifactType: parseArtifactType(value.expectedArtifactType, `${path}.expectedArtifactType`),
  };
}

function parseOutputDeclaration(input: unknown, path: string): OutputDeclaration {
  const value = parseRecord(input, path);
  assertExactKeys(value, ["name", "artifactType", "description"], path);
  const base = {
    name: parseNonEmptyString(value.name, `${path}.name`),
    artifactType: parseArtifactType(value.artifactType, `${path}.artifactType`),
  };
  if (value.description === undefined) {
    return base;
  }
  return {
    ...base,
    description: parseNonEmptyString(value.description, `${path}.description`),
  };
}

function parseAcceptanceCriteria(input: unknown, path: string): AcceptanceCriteria {
  const value = parseRecord(input, path);
  assertExactKeys(value, ["id", "description", "mode"], path);
  return {
    id: parseNonEmptyString(value.id, `${path}.id`),
    description: parseNonEmptyString(value.description, `${path}.description`),
    mode: parseEvaluationMode(value.mode, `${path}.mode`),
  };
}

function parseInvocation(input: unknown, path: string): Invocation {
  const value = parseRecord(input, path);
  assertExactKeys(
    value,
    [
      "id",
      "purpose",
      "target",
      "outputs",
      "acceptanceCriteria",
      "riskClass",
      "approvalPolicy",
      "failurePolicy",
      "joinPolicy",
    ],
    path,
  );
  return {
    id: parseNonEmptyString(value.id, `${path}.id`),
    purpose: parseNonEmptyString(value.purpose, `${path}.purpose`),
    target: parseInvocationTarget(value.target, `${path}.target`),
    outputs: parseArray(value.outputs, parseOutputDeclaration, `${path}.outputs`),
    acceptanceCriteria: parseArray(value.acceptanceCriteria, parseAcceptanceCriteria, `${path}.acceptanceCriteria`),
    riskClass: parseRiskClass(value.riskClass, `${path}.riskClass`),
    approvalPolicy: parseApprovalPolicy(value.approvalPolicy, `${path}.approvalPolicy`),
    failurePolicy: parseFailurePolicy(value.failurePolicy, `${path}.failurePolicy`),
    joinPolicy: parseJoinPolicy(value.joinPolicy, `${path}.joinPolicy`),
  };
}

function parseInvocationDependency(input: unknown, path: string): InvocationDependency {
  const value = parseRecord(input, path);
  assertExactKeys(value, ["id", "fromInvocationId", "toInvocationId", "condition", "inputBindings"], path);
  return {
    id: parseNonEmptyString(value.id, `${path}.id`),
    fromInvocationId: parseNonEmptyString(value.fromInvocationId, `${path}.fromInvocationId`),
    toInvocationId: parseNonEmptyString(value.toInvocationId, `${path}.toInvocationId`),
    condition: parseDependencyCondition(value.condition, `${path}.condition`),
    inputBindings: parseArray(value.inputBindings, parseInputBinding, `${path}.inputBindings`),
  };
}

function parseExecutionPlanValue(input: unknown, path: string): ExecutionPlan {
  const value = parseRecord(input, path);
  assertExactKeys(value, ["schemaVersion", "goal", "maxParallelism", "invocations", "dependencies"], path);
  const invocations = parseArray(value.invocations, parseInvocation, `${path}.invocations`);
  if (invocations.length === 0) {
    throw new ExecutionPlanSchemaError("expected at least one invocation", `${path}.invocations`);
  }
  return {
    schemaVersion: parseLiteralOne(value.schemaVersion, `${path}.schemaVersion`),
    goal: parseNonEmptyString(value.goal, `${path}.goal`),
    maxParallelism: parsePositiveInteger(value.maxParallelism, `${path}.maxParallelism`),
    invocations,
    dependencies: parseArray(value.dependencies, parseInvocationDependency, `${path}.dependencies`),
  };
}

export const invocationTargetSchema = createRuntimeSchema(parseInvocationTarget);
export const dependencyConditionSchema = createRuntimeSchema(parseDependencyCondition);
export const inputBindingSchema = createRuntimeSchema(parseInputBinding);
export const outputDeclarationSchema = createRuntimeSchema(parseOutputDeclaration);
export const acceptanceCriteriaSchema = createRuntimeSchema(parseAcceptanceCriteria);
export const invocationSchema = createRuntimeSchema(parseInvocation);
export const invocationDependencySchema = createRuntimeSchema(parseInvocationDependency);

/**
 * Structural schema only. Cross-node semantics (cycles, missing nodes,
 * artifact compatibility, reachability and graph limits) belong to PR-03's
 * deterministic graph validator, not to this parser.
 */
export const executionPlanSchema = createRuntimeSchema(parseExecutionPlanValue);

export function parseExecutionPlan(input: unknown): ExecutionPlan {
  return executionPlanSchema.parse(input);
}
