import type { DependencyCondition } from "./dependencies.js";
import type { InvocationTarget } from "./targets.js";
import { EXECUTION_PLAN_SCHEMA_VERSION } from "./types.js";
import type {
  AcceptanceCriteria,
  ApprovalPolicy,
  DeterministicCriterionBinding,
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

const ARTIFACT_TYPES = ["TEXT", "PROMPT", "DOCUMENT", "CODE", "IMAGE", "PLAN", "FILE", "PATCH", "JSON"] as const;
const EVALUATION_MODES = ["DETERMINISTIC", "AI_EVALUATOR", "HUMAN_APPROVAL"] as const;
const RISK_CLASSES = ["READ_ONLY", "INTERNAL_WRITE", "EXTERNAL_SIDE_EFFECT", "DESTRUCTIVE", "FINANCIAL"] as const;
const APPROVAL_POLICIES = ["AUTO", "USER_CONFIRMATION", "HUMAN_APPROVAL"] as const;

const EXECUTION_PLAN_RUNTIME_LIMITS = {
  idMax: 96,
  goalMax: 4_000,
  purposeMax: 1_000,
  descriptionMax: 2_000,
  modelOrAgentMax: 128,
  outcomeMax: 128,
  jsonPointerMax: 512,
  maxInvocations: 64,
  maxDependencies: 256,
  maxParallelism: 16,
  maxOutputsPerInvocation: 32,
  maxCriteriaPerInvocation: 32,
  maxBindingsPerDependency: 32,
} as const;
const GRAPH_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
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

function parseBoundedString(
  input: unknown,
  path: string,
  maxLength: number,
  options: { allowEmpty?: boolean; trim?: boolean } = {},
): string {
  if (typeof input !== "string") {
    throw new ExecutionPlanSchemaError("expected string", path);
  }
  const value = options.trim === false ? input : input.trim();
  if ((!options.allowEmpty && value.length === 0) || value.length > maxLength) {
    throw new ExecutionPlanSchemaError(
      `expected string with at most ${maxLength} characters`,
      path,
    );
  }
  return value;
}

function parseGraphKey(input: unknown, path: string): string {
  const value = parseBoundedString(
    input,
    path,
    EXECUTION_PLAN_RUNTIME_LIMITS.idMax,
  );
  if (!GRAPH_KEY_PATTERN.test(value)) {
    throw new ExecutionPlanSchemaError("invalid graph key", path);
  }
  return value;
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

function parseArray<T>(
  input: unknown,
  parser: Parser<T>,
  path: string,
  maxLength?: number,
): T[] {
  if (!Array.isArray(input)) {
    throw new ExecutionPlanSchemaError("expected array", path);
  }
  if (maxLength !== undefined && input.length > maxLength) {
    throw new ExecutionPlanSchemaError(
      `expected at most ${maxLength} items`,
      path,
    );
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
      return { kind, modelSlug: parseBoundedString(value.modelSlug, `${path}.modelSlug`, EXECUTION_PLAN_RUNTIME_LIMITS.modelOrAgentMax) };
    case "AGENT":
      assertExactKeys(value, ["kind", "agentId"], path);
      return { kind, agentId: parseBoundedString(value.agentId, `${path}.agentId`, EXECUTION_PLAN_RUNTIME_LIMITS.modelOrAgentMax) };
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
      return { kind, outcome: parseBoundedString(value.outcome, `${path}.outcome`, EXECUTION_PLAN_RUNTIME_LIMITS.outcomeMax) };
    default:
      throw new ExecutionPlanSchemaError("unknown dependency condition kind", `${path}.kind`);
  }
}

function parseInputBinding(input: unknown, path: string): InputBinding {
  const value = parseRecord(input, path);
  assertExactKeys(value, ["inputName", "sourceOutputName", "expectedArtifactType"], path);
  return {
    inputName: parseGraphKey(value.inputName, `${path}.inputName`),
    sourceOutputName: parseGraphKey(value.sourceOutputName, `${path}.sourceOutputName`),
    expectedArtifactType: parseArtifactType(value.expectedArtifactType, `${path}.expectedArtifactType`),
  };
}

function parseOutputDeclaration(input: unknown, path: string): OutputDeclaration {
  const value = parseRecord(input, path);
  assertExactKeys(value, ["name", "artifactType", "description"], path);
  const base = {
    name: parseGraphKey(value.name, `${path}.name`),
    artifactType: parseArtifactType(value.artifactType, `${path}.artifactType`),
  };
  if (value.description === undefined) {
    return base;
  }
  return {
    ...base,
    description: parseBoundedString(value.description, `${path}.description`, EXECUTION_PLAN_RUNTIME_LIMITS.descriptionMax),
  };
}

function parseJsonPrimitive(
  input: unknown,
  path: string,
): string | number | boolean | null {
  if (
    input === null ||
    (typeof input === "string" &&
      input.length <= EXECUTION_PLAN_RUNTIME_LIMITS.descriptionMax) ||
    typeof input === "boolean" ||
    (typeof input === "number" && Number.isFinite(input))
  ) {
    return input;
  }
  throw new ExecutionPlanSchemaError("expected JSON primitive", path);
}

function parseDeterministicCriterionBinding(
  input: unknown,
  path: string,
): DeterministicCriterionBinding {
  const value = parseRecord(input, path);
  const kind = parseNonEmptyString(value.kind, `${path}.kind`);
  switch (kind) {
    case "ARTIFACT_EXISTS":
      assertExactKeys(value, ["kind", "inputName"], path);
      return {
        kind,
        inputName: parseGraphKey(value.inputName, `${path}.inputName`),
      };
    case "TEXT_CONTAINS": {
      assertExactKeys(value, ["kind", "inputName", "value", "caseSensitive"], path);
      const caseSensitive =
        value.caseSensitive === undefined
          ? undefined
          : (() => {
              if (typeof value.caseSensitive !== "boolean") {
                throw new ExecutionPlanSchemaError("expected boolean", `${path}.caseSensitive`);
              }
              return value.caseSensitive;
            })();
      return {
        kind,
        inputName: parseGraphKey(value.inputName, `${path}.inputName`),
        value: parseBoundedString(value.value, `${path}.value`, EXECUTION_PLAN_RUNTIME_LIMITS.descriptionMax),
        ...(caseSensitive === undefined ? {} : { caseSensitive }),
      };
    }
    case "JSON_EQUALS":
      assertExactKeys(value, ["kind", "inputName", "path", "expectedValue"], path);
      return {
        kind,
        inputName: parseGraphKey(value.inputName, `${path}.inputName`),
        path: parseBoundedString(
          value.path,
          `${path}.path`,
          EXECUTION_PLAN_RUNTIME_LIMITS.jsonPointerMax,
          { allowEmpty: true, trim: false },
        ),
        expectedValue: parseJsonPrimitive(
          value.expectedValue,
          `${path}.expectedValue`,
        ),
      };
    default:
      throw new ExecutionPlanSchemaError(
        "unknown deterministic criterion binding kind",
        `${path}.kind`,
      );
  }
}

function parseAcceptanceCriteria(input: unknown, path: string): AcceptanceCriteria {
  const value = parseRecord(input, path);
  assertExactKeys(value, ["id", "description", "mode", "binding"], path);
  return {
    id: parseGraphKey(value.id, `${path}.id`),
    description: parseBoundedString(value.description, `${path}.description`, EXECUTION_PLAN_RUNTIME_LIMITS.descriptionMax),
    mode: parseEvaluationMode(value.mode, `${path}.mode`),
    ...(value.binding === undefined
      ? {}
      : {
          binding: parseDeterministicCriterionBinding(
            value.binding,
            `${path}.binding`,
          ),
        }),
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
    id: parseGraphKey(value.id, `${path}.id`),
    purpose: parseBoundedString(value.purpose, `${path}.purpose`, EXECUTION_PLAN_RUNTIME_LIMITS.purposeMax),
    target: parseInvocationTarget(value.target, `${path}.target`),
    outputs: parseArray(
      value.outputs,
      parseOutputDeclaration,
      `${path}.outputs`,
      EXECUTION_PLAN_RUNTIME_LIMITS.maxOutputsPerInvocation,
    ),
    acceptanceCriteria: parseArray(
      value.acceptanceCriteria,
      parseAcceptanceCriteria,
      `${path}.acceptanceCriteria`,
      EXECUTION_PLAN_RUNTIME_LIMITS.maxCriteriaPerInvocation,
    ),
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
    id: parseGraphKey(value.id, `${path}.id`),
    fromInvocationId: parseGraphKey(value.fromInvocationId, `${path}.fromInvocationId`),
    toInvocationId: parseGraphKey(value.toInvocationId, `${path}.toInvocationId`),
    condition: parseDependencyCondition(value.condition, `${path}.condition`),
    inputBindings: parseArray(
      value.inputBindings,
      parseInputBinding,
      `${path}.inputBindings`,
      EXECUTION_PLAN_RUNTIME_LIMITS.maxBindingsPerDependency,
    ),
  };
}

function parseExecutionPlanValue(input: unknown, path: string): ExecutionPlan {
  const value = parseRecord(input, path);
  assertExactKeys(value, ["schemaVersion", "goal", "maxParallelism", "invocations", "dependencies"], path);
  const invocations = parseArray(
    value.invocations,
    parseInvocation,
    `${path}.invocations`,
    EXECUTION_PLAN_RUNTIME_LIMITS.maxInvocations,
  );
  if (invocations.length === 0) {
    throw new ExecutionPlanSchemaError("expected at least one invocation", `${path}.invocations`);
  }
  return {
    schemaVersion: parseLiteralOne(value.schemaVersion, `${path}.schemaVersion`),
    goal: parseBoundedString(value.goal, `${path}.goal`, EXECUTION_PLAN_RUNTIME_LIMITS.goalMax),
    maxParallelism: (() => {
      const valueParsed = parsePositiveInteger(
        value.maxParallelism,
        `${path}.maxParallelism`,
      );
      if (valueParsed > EXECUTION_PLAN_RUNTIME_LIMITS.maxParallelism) {
        throw new ExecutionPlanSchemaError(
          `expected at most ${EXECUTION_PLAN_RUNTIME_LIMITS.maxParallelism}`,
          `${path}.maxParallelism`,
        );
      }
      return valueParsed;
    })(),
    invocations,
    dependencies: parseArray(
      value.dependencies,
      parseInvocationDependency,
      `${path}.dependencies`,
      EXECUTION_PLAN_RUNTIME_LIMITS.maxDependencies,
    ),
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
