import type {
  AcceptanceCriteria,
  ArtifactType,
  DeterministicCriterionBinding,
  InputBinding,
  InvocationDependency,
  OutputDeclaration,
} from "./types.js";
import {
  SEMANTIC_PLANNER_LIMITS,
  SemanticPlannerError,
  type SemanticPlannerDependencyDraft,
  type SemanticPlannerDraft,
  type SemanticPlannerInvocationDraft,
  type SemanticPlannerTargetHint,
} from "./semantic-planner-contract.js";

export function parseSemanticPlannerOutput(raw: string): SemanticPlannerDraft {
  if (raw.length > SEMANTIC_PLANNER_LIMITS.rawOutputMax) {
    invalid("$", "planner output exceeds the configured size limit");
  }

  const value = parseJsonObject(raw);
  const record = asRecord(value, "$");
  exactKeys(
    record,
    [
      "schemaVersion",
      "decision",
      "confidence",
      "clarificationQuestion",
      "goal",
      "invocations",
      "dependencies",
    ],
    "$",
  );
  if (record.schemaVersion !== 1) {
    invalid("$.schemaVersion", "expected schema version 1");
  }

  const decision = oneOf(record.decision, ["PLAN", "CLARIFY"] as const, "$.decision");
  const confidence = finiteNumber(record.confidence, "$.confidence");
  if (confidence < 0 || confidence > SEMANTIC_PLANNER_LIMITS.maxConfidence) {
    invalid("$.confidence", "expected a number between 0 and 1");
  }

  if (decision === "CLARIFY") {
    if (record.goal !== null) {
      invalid("$.goal", "clarification output must use null goal");
    }
    const invocations = array(record.invocations, "$.invocations");
    const dependencies = array(record.dependencies, "$.dependencies");
    if (invocations.length !== 0 || dependencies.length !== 0) {
      invalid("$", "clarification output cannot include graph nodes");
    }
    return {
      schemaVersion: 1,
      decision,
      confidence,
      clarificationQuestion: boundedString(
        record.clarificationQuestion,
        SEMANTIC_PLANNER_LIMITS.clarificationMax,
        "$.clarificationQuestion",
      ),
      goal: null,
      invocations: [],
      dependencies: [],
    };
  }

  if (record.clarificationQuestion !== null) {
    invalid(
      "$.clarificationQuestion",
      "plan output must use null clarificationQuestion",
    );
  }

  const rawInvocations = array(record.invocations, "$.invocations");
  const rawDependencies = array(record.dependencies, "$.dependencies");
  if (
    rawInvocations.length === 0 ||
    rawInvocations.length > SEMANTIC_PLANNER_LIMITS.maxInvocations
  ) {
    invalid("$.invocations", "invalid invocation count");
  }
  if (rawDependencies.length > SEMANTIC_PLANNER_LIMITS.maxDependencies) {
    invalid("$.dependencies", "invalid dependency count");
  }

  return {
    schemaVersion: 1,
    decision,
    confidence,
    clarificationQuestion: null,
    goal: boundedString(record.goal, 4_000, "$.goal"),
    invocations: rawInvocations.map((item, index) =>
      parseInvocationDraft(item, `$.invocations[${index}]`),
    ),
    dependencies: rawDependencies.map((item, index) =>
      parseDependencyDraft(item, `$.dependencies[${index}]`),
    ),
  };
}

function parseInvocationDraft(
  input: unknown,
  path: string,
): SemanticPlannerInvocationDraft {
  const value = asRecord(input, path);
  exactKeys(
    value,
    [
      "id",
      "purpose",
      "targetHint",
      "outputs",
      "acceptanceCriteria",
      "riskHint",
      "failurePolicy",
      "joinPolicy",
    ],
    path,
  );

  const outputs = array(value.outputs, `${path}.outputs`);
  const criteria = array(value.acceptanceCriteria, `${path}.acceptanceCriteria`);
  if (outputs.length > SEMANTIC_PLANNER_LIMITS.maxOutputsPerInvocation) {
    invalid(`${path}.outputs`, "too many output declarations");
  }
  if (criteria.length > SEMANTIC_PLANNER_LIMITS.maxCriteriaPerInvocation) {
    invalid(`${path}.acceptanceCriteria`, "too many acceptance criteria");
  }

  return {
    id: graphKey(value.id, `${path}.id`),
    purpose: boundedString(value.purpose, 1_000, `${path}.purpose`),
    targetHint: parseTargetHint(value.targetHint, `${path}.targetHint`),
    outputs: outputs.map((item, index) =>
      parseOutput(item, `${path}.outputs[${index}]`),
    ),
    acceptanceCriteria: criteria.map((item, index) =>
      parseCriterion(item, `${path}.acceptanceCriteria[${index}]`),
    ),
    riskHint: oneOf(
      value.riskHint,
      [
        "READ_ONLY",
        "INTERNAL_WRITE",
        "EXTERNAL_SIDE_EFFECT",
        "DESTRUCTIVE",
        "FINANCIAL",
      ] as const,
      `${path}.riskHint`,
    ),
    failurePolicy: oneOf(
      value.failurePolicy,
      ["FAIL_PLAN", "CONTINUE"] as const,
      `${path}.failurePolicy`,
    ),
    joinPolicy: oneOf(
      value.joinPolicy,
      ["ALL_REQUIRED", "ANY_REQUIRED", "ALL_SETTLED"] as const,
      `${path}.joinPolicy`,
    ),
  };
}

function parseTargetHint(
  input: unknown,
  path: string,
): SemanticPlannerTargetHint {
  const value = asRecord(input, path);
  const kind = oneOf(value.kind, ["MENTION", "EVALUATOR"] as const, `${path}.kind`);
  if (kind === "EVALUATOR") {
    exactKeys(value, ["kind"], path);
    return { kind };
  }
  exactKeys(value, ["kind", "occurrenceId", "semanticRole"], path);
  return {
    kind,
    occurrenceId: boundedString(value.occurrenceId, 160, `${path}.occurrenceId`),
    semanticRole: oneOf(
      value.semanticRole,
      ["EXECUTION"] as const,
      `${path}.semanticRole`,
    ),
  };
}

function parseOutput(input: unknown, path: string): OutputDeclaration {
  const value = asRecord(input, path);
  exactKeys(value, ["name", "artifactType", "description"], path);
  const description =
    value.description === undefined
      ? undefined
      : boundedString(value.description, 2_000, `${path}.description`);
  return {
    name: graphKey(value.name, `${path}.name`),
    artifactType: artifactType(value.artifactType, `${path}.artifactType`),
    ...(description ? { description } : {}),
  };
}

function parseCriterionBinding(
  input: unknown,
  path: string,
): DeterministicCriterionBinding {
  const value = asRecord(input, path);
  const kind = oneOf(
    value.kind,
    ["ARTIFACT_EXISTS", "TEXT_CONTAINS", "JSON_EQUALS"] as const,
    `${path}.kind`,
  );
  switch (kind) {
    case "ARTIFACT_EXISTS":
      exactKeys(value, ["kind", "inputName"], path);
      return {
        kind,
        inputName: graphKey(value.inputName, `${path}.inputName`),
      };
    case "TEXT_CONTAINS": {
      exactKeys(value, ["kind", "inputName", "value", "caseSensitive"], path);
      const caseSensitive =
        value.caseSensitive === undefined
          ? undefined
          : booleanValue(value.caseSensitive, `${path}.caseSensitive`);
      return {
        kind,
        inputName: graphKey(value.inputName, `${path}.inputName`),
        value: boundedString(value.value, 2_000, `${path}.value`),
        ...(caseSensitive === undefined ? {} : { caseSensitive }),
      };
    }
    case "JSON_EQUALS":
      exactKeys(value, ["kind", "inputName", "path", "expectedValue"], path);
      return {
        kind,
        inputName: graphKey(value.inputName, `${path}.inputName`),
        path: stringValue(value.path, 512, `${path}.path`),
        expectedValue: jsonPrimitive(value.expectedValue, `${path}.expectedValue`),
      };
  }
}

function parseCriterion(input: unknown, path: string): AcceptanceCriteria {
  const value = asRecord(input, path);
  exactKeys(value, ["id", "description", "mode", "binding"], path);
  return {
    id: graphKey(value.id, `${path}.id`),
    description: boundedString(value.description, 2_000, `${path}.description`),
    mode: oneOf(
      value.mode,
      ["DETERMINISTIC", "AI_EVALUATOR", "HUMAN_APPROVAL"] as const,
      `${path}.mode`,
    ),
    ...(value.binding === undefined
      ? {}
      : { binding: parseCriterionBinding(value.binding, `${path}.binding`) }),
  };
}

function parseDependencyDraft(
  input: unknown,
  path: string,
): SemanticPlannerDependencyDraft {
  const value = asRecord(input, path);
  exactKeys(
    value,
    ["id", "fromInvocationId", "toInvocationId", "condition", "inputBindings"],
    path,
  );
  const conditionValue = asRecord(value.condition, `${path}.condition`);
  const conditionKind = oneOf(
    conditionValue.kind,
    ["DATA", "ON_SUCCESS", "ON_FAILURE", "ALWAYS", "OUTCOME"] as const,
    `${path}.condition.kind`,
  );
  const condition: InvocationDependency["condition"] =
    conditionKind === "OUTCOME"
      ? (() => {
          exactKeys(conditionValue, ["kind", "outcome"], `${path}.condition`);
          return {
            kind: "OUTCOME" as const,
            outcome: boundedString(
              conditionValue.outcome,
              128,
              `${path}.condition.outcome`,
            ),
          };
        })()
      : (() => {
          exactKeys(conditionValue, ["kind"], `${path}.condition`);
          return { kind: conditionKind };
        })();

  const bindings = array(value.inputBindings, `${path}.inputBindings`);
  if (bindings.length > SEMANTIC_PLANNER_LIMITS.maxBindingsPerDependency) {
    invalid(`${path}.inputBindings`, "too many input bindings");
  }

  return {
    id: graphKey(value.id, `${path}.id`),
    fromInvocationId: graphKey(
      value.fromInvocationId,
      `${path}.fromInvocationId`,
    ),
    toInvocationId: graphKey(
      value.toInvocationId,
      `${path}.toInvocationId`,
    ),
    condition,
    inputBindings: bindings.map((item, index) =>
      parseBinding(item, `${path}.inputBindings[${index}]`),
    ),
  };
}

function parseBinding(input: unknown, path: string): InputBinding {
  const value = asRecord(input, path);
  exactKeys(
    value,
    ["inputName", "sourceOutputName", "expectedArtifactType"],
    path,
  );
  return {
    inputName: graphKey(value.inputName, `${path}.inputName`),
    sourceOutputName: graphKey(
      value.sourceOutputName,
      `${path}.sourceOutputName`,
    ),
    expectedArtifactType: artifactType(
      value.expectedArtifactType,
      `${path}.expectedArtifactType`,
    ),
  };
}

function artifactType(input: unknown, path: string): ArtifactType {
  return oneOf(
    input,
    ["TEXT", "PROMPT", "DOCUMENT", "CODE", "IMAGE", "PLAN", "FILE", "PATCH", "JSON"] as const,
    path,
  );
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    throw new SemanticPlannerError(
      "OUTPUT_INVALID",
      "Planner output was not one strict JSON object",
    );
  }
}

function asRecord(input: unknown, path: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    invalid(path, "expected object");
  }
  return input as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid(path, `unknown field ${key}`);
  }
}

function array(input: unknown, path: string): unknown[] {
  if (!Array.isArray(input)) invalid(path, "expected array");
  return input;
}

function booleanValue(input: unknown, path: string): boolean {
  if (typeof input !== "boolean") invalid(path, "expected boolean");
  return input as boolean;
}

function stringValue(input: unknown, max: number, path: string): string {
  if (typeof input !== "string" || input.length > max) {
    invalid(path, `expected string with at most ${max} characters`);
  }
  return input as string;
}

function jsonPrimitive(
  input: unknown,
  path: string,
): string | number | boolean | null {
  if (
    input === null ||
    (typeof input === "string" && input.length <= 2_000) ||
    typeof input === "boolean" ||
    (typeof input === "number" && Number.isFinite(input))
  ) {
    return input;
  }
  invalid(path, "expected JSON primitive");
}

function finiteNumber(input: unknown, path: string): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    invalid(path, "expected finite number");
  }
  return input;
}

function boundedString(input: unknown, max: number, path: string): string {
  if (typeof input !== "string") invalid(path, "expected string");
  const value = input.trim();
  if (value.length === 0 || value.length > max) {
    invalid(path, `expected non-empty string up to ${max} characters`);
  }
  return value;
}

function graphKey(input: unknown, path: string): string {
  const value = boundedString(input, 96, path);
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) {
    invalid(path, "invalid graph identifier");
  }
  return value;
}

function oneOf<const T extends readonly string[]>(
  input: unknown,
  values: T,
  path: string,
): T[number] {
  if (typeof input !== "string" || !values.includes(input as T[number])) {
    invalid(path, `expected one of ${values.join(", ")}`);
  }
  return input as T[number];
}

function invalid(path: string, message: string): never {
  throw new SemanticPlannerError("OUTPUT_INVALID", `${path}: ${message}`);
}
