import {
  invocationTargetForPlannerMention,
  type PlannerInvocationMention,
} from "./planner-mentions.js";
import { validateExecutionPlanGraph } from "./graph.js";
import { executionPlanSchema } from "./plan-schema.js";
import type {
  AcceptanceCriteria,
  ArtifactType,
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
  maxInvocations: 64,
  maxDependencies: 256,
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
      clarificationQuestion: string | null;
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

export interface SemanticWorkflowPlannerInput {
  userText: string;
  mentions: readonly PlannerInvocationMention[];
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

export class SemanticWorkflowPlanner {
  constructor(private readonly model: SemanticPlannerModel) {}

  async plan(
    input: SemanticWorkflowPlannerInput & { correlationId: string },
  ): Promise<SemanticWorkflowPlannerResult> {
    const prompt = buildSemanticPlannerPrompt(input);
    const raw = await this.model.complete({
      prompt,
      correlationId: input.correlationId,
    });
    return compileSemanticPlannerDraft(
      input,
      parseSemanticPlannerOutput(raw),
    );
  }
}

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

  const mentionConstraints = input.mentions.map((mention) => ({
    occurrenceId: mention.occurrenceId,
    occurrenceIndex: mention.occurrenceIndex,
    canonicalHandle: mention.canonicalHandle,
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
    "USER_REQUEST:",
    userText,
  ].join("\n");
}

export function parseSemanticPlannerOutput(raw: string): SemanticPlannerDraft {
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

export function compileSemanticPlannerDraft(
  input: SemanticWorkflowPlannerInput,
  draft: SemanticPlannerDraft,
): SemanticWorkflowPlannerResult {
  if (draft.decision === "CLARIFY") {
    return {
      kind: "CLARIFY",
      confidence: draft.confidence,
      clarificationQuestion: draft.clarificationQuestion,
    };
  }

  if (draft.confidence < SEMANTIC_PLANNER_LIMITS.minPlanConfidence) {
    return {
      kind: "CLARIFY",
      confidence: draft.confidence,
      clarificationQuestion:
        "Could you clarify the intended workflow before I create it?",
    };
  }

  const mentionByOccurrence = new Map(
    input.mentions.map((mention) => [mention.occurrenceId, mention]),
  );
  const consumedMentions = new Set<string>();

  const provisional: ExecutionPlan = {
    schemaVersion: 1,
    goal: draft.goal.trim(),
    maxParallelism: Math.min(
      SEMANTIC_PLANNER_LIMITS.defaultMaxParallelism,
      Math.max(1, draft.invocations.length),
    ),
    invocations: draft.invocations.map((invocation) => {
      const target = resolveTarget(
        invocation.targetHint,
        mentionByOccurrence,
        consumedMentions,
      );
      return {
        id: invocation.id,
        purpose: invocation.purpose,
        target,
        outputs: invocation.outputs,
        acceptanceCriteria: invocation.acceptanceCriteria,
        riskClass: invocation.riskHint,
        approvalPolicy:
          target.kind === "VIMLA" || invocation.riskHint !== "READ_ONLY"
            ? "USER_CONFIRMATION"
            : "AUTO",
        failurePolicy: invocation.failurePolicy,
        joinPolicy: invocation.joinPolicy,
      };
    }),
    dependencies: draft.dependencies.map((dependency) => ({
      ...dependency,
    })),
  };

  if (consumedMentions.size !== input.mentions.length) {
    const missing = input.mentions
      .filter((mention) => !consumedMentions.has(mention.occurrenceId))
      .map((mention) => mention.occurrenceId);
    throw new SemanticPlannerError(
      "MENTION_CONSTRAINT_VIOLATION",
      `Planner ignored explicit executor mention(s): ${missing.join(", ")}`,
    );
  }

  try {
    validateExecutionPlanGraph(provisional);
  } catch (error: unknown) {
    throw new SemanticPlannerError(
      "GRAPH_INVALID",
      error instanceof Error ? error.message : "Planner proposed an invalid graph",
    );
  }

  const normalized = normalizeSemanticExecutionPlan(provisional);
  const parsed = executionPlanSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new SemanticPlannerError("GRAPH_INVALID", parsed.error.message);
  }
  try {
    validateExecutionPlanGraph(parsed.data);
  } catch (error: unknown) {
    throw new SemanticPlannerError(
      "GRAPH_INVALID",
      error instanceof Error ? error.message : "Normalized planner graph is invalid",
    );
  }

  return {
    kind: "PLAN",
    confidence: draft.confidence,
    plan: parsed.data,
  };
}

export function normalizeSemanticExecutionPlan(
  plan: ExecutionPlan,
): ExecutionPlan {
  const order = stableTopologicalOrder(plan);
  const canonicalId = new Map(
    order.map((id, index) => [
      id,
      `step-${String(index + 1).padStart(2, "0")}`,
    ]),
  );

  const invocations = order.map((originalId) => {
    const invocation = plan.invocations.find((item) => item.id === originalId);
    if (!invocation) {
      throw new SemanticPlannerError(
        "GRAPH_INVALID",
        `Missing invocation during normalization: ${originalId}`,
      );
    }
    return {
      ...invocation,
      id: requiredMappedId(canonicalId, originalId),
      outputs: [...invocation.outputs].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      acceptanceCriteria: [...invocation.acceptanceCriteria].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
    };
  });

  const dependencies = plan.dependencies
    .map((dependency) => ({
      ...dependency,
      fromInvocationId: requiredMappedId(
        canonicalId,
        dependency.fromInvocationId,
      ),
      toInvocationId: requiredMappedId(
        canonicalId,
        dependency.toInvocationId,
      ),
      inputBindings: [...dependency.inputBindings].sort(
        (a, b) =>
          a.inputName.localeCompare(b.inputName) ||
          a.sourceOutputName.localeCompare(b.sourceOutputName),
      ),
    }))
    .sort(
      (a, b) =>
        a.fromInvocationId.localeCompare(b.fromInvocationId) ||
        a.toInvocationId.localeCompare(b.toInvocationId) ||
        conditionSortKey(a.condition).localeCompare(conditionSortKey(b.condition)),
    )
    .map((dependency, index) => ({
      ...dependency,
      id: `edge-${String(index + 1).padStart(2, "0")}`,
    }));

  return {
    schemaVersion: 1,
    goal: plan.goal.trim(),
    maxParallelism: plan.maxParallelism,
    invocations,
    dependencies,
  };
}

function resolveTarget(
  hint: SemanticPlannerTargetHint,
  mentionByOccurrence: ReadonlyMap<string, PlannerInvocationMention>,
  consumedMentions: Set<string>,
): ExecutionPlan["invocations"][number]["target"] {
  if (hint.kind === "EVALUATOR") {
    return { kind: "EVALUATOR" };
  }

  const mention = mentionByOccurrence.get(hint.occurrenceId);
  if (!mention) {
    throw new SemanticPlannerError(
      "TARGET_RESOLUTION_FAILED",
      `Planner referenced unknown mention occurrence ${hint.occurrenceId}`,
    );
  }
  if (consumedMentions.has(hint.occurrenceId)) {
    throw new SemanticPlannerError(
      "MENTION_CONSTRAINT_VIOLATION",
      `Mention occurrence ${hint.occurrenceId} was consumed more than once`,
    );
  }
  consumedMentions.add(hint.occurrenceId);

  return hint.semanticRole === "EVALUATION"
    ? { kind: "EVALUATOR" }
    : invocationTargetForPlannerMention(mention);
}

function stableTopologicalOrder(plan: ExecutionPlan): string[] {
  const ids = new Set(plan.invocations.map((invocation) => invocation.id));
  const indegree = new Map<string, number>(
    [...ids].map((id) => [id, 0]),
  );
  const outgoing = new Map<string, string[]>(
    [...ids].map((id) => [id, []]),
  );

  for (const dependency of plan.dependencies) {
    if (
      !ids.has(dependency.fromInvocationId) ||
      !ids.has(dependency.toInvocationId)
    ) {
      throw new SemanticPlannerError(
        "GRAPH_INVALID",
        "Cannot normalize a graph with unknown invocation references",
      );
    }
    indegree.set(
      dependency.toInvocationId,
      (indegree.get(dependency.toInvocationId) ?? 0) + 1,
    );
    outgoing.get(dependency.fromInvocationId)?.push(dependency.toInvocationId);
  }
  for (const values of outgoing.values()) values.sort();

  const ready = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort();
  const order: string[] = [];

  while (ready.length > 0) {
    const id = ready.shift();
    if (!id) break;
    order.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const degree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, degree);
      if (degree === 0) {
        ready.push(next);
        ready.sort();
      }
    }
  }

  if (order.length !== ids.size) {
    throw new SemanticPlannerError(
      "GRAPH_INVALID",
      "Execution graph must be acyclic",
    );
  }
  return order;
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
  return {
    id: graphKey(value.id, `${path}.id`),
    purpose: boundedString(value.purpose, 1_000, `${path}.purpose`),
    targetHint: parseTargetHint(value.targetHint, `${path}.targetHint`),
    outputs: array(value.outputs, `${path}.outputs`).map((item, index) =>
      parseOutput(item, `${path}.outputs[${index}]`),
    ),
    acceptanceCriteria: array(
      value.acceptanceCriteria,
      `${path}.acceptanceCriteria`,
    ).map((item, index) =>
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
      ["EXECUTION", "EVALUATION"] as const,
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

function parseCriterion(input: unknown, path: string): AcceptanceCriteria {
  const value = asRecord(input, path);
  exactKeys(value, ["id", "description", "mode"], path);
  return {
    id: graphKey(value.id, `${path}.id`),
    description: boundedString(value.description, 2_000, `${path}.description`),
    mode: oneOf(
      value.mode,
      ["DETERMINISTIC", "AI_EVALUATOR", "HUMAN_APPROVAL"] as const,
      `${path}.mode`,
    ),
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
  const condition =
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
    inputBindings: array(value.inputBindings, `${path}.inputBindings`).map(
      (item, index) => {
        const binding = asRecord(
          item,
          `${path}.inputBindings[${index}]`,
        );
        exactKeys(
          binding,
          ["inputName", "sourceOutputName", "expectedArtifactType"],
          `${path}.inputBindings[${index}]`,
        );
        return {
          inputName: graphKey(
            binding.inputName,
            `${path}.inputBindings[${index}].inputName`,
          ),
          sourceOutputName: graphKey(
            binding.sourceOutputName,
            `${path}.inputBindings[${index}].sourceOutputName`,
          ),
          expectedArtifactType: artifactType(
            binding.expectedArtifactType,
            `${path}.inputBindings[${index}].expectedArtifactType`,
          ),
        };
      },
    ),
  };
}

function artifactType(input: unknown, path: string): ArtifactType {
  return oneOf(
    input,
    ["TEXT", "PROMPT", "DOCUMENT", "CODE", "IMAGE", "PLAN", "FILE", "PATCH"] as const,
    path,
  );
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new SemanticPlannerError(
      "OUTPUT_INVALID",
      "Planner output did not contain a JSON object",
    );
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as unknown;
  } catch {
    throw new SemanticPlannerError(
      "OUTPUT_INVALID",
      "Planner output was not valid JSON",
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
  if (typeof input !== "string" || !values.includes(input)) {
    invalid(path, `expected one of ${values.join(", ")}`);
  }
  return input as T[number];
}

function requiredMappedId(
  ids: ReadonlyMap<string, string>,
  original: string,
): string {
  const value = ids.get(original);
  if (!value) {
    throw new SemanticPlannerError(
      "GRAPH_INVALID",
      `Missing normalized id for ${original}`,
    );
  }
  return value;
}

function conditionSortKey(
  condition: InvocationDependency["condition"],
): string {
  return condition.kind === "OUTCOME"
    ? `${condition.kind}:${condition.outcome}`
    : condition.kind;
}

function invalid(path: string, message: string): never {
  throw new SemanticPlannerError("OUTPUT_INVALID", `${path}: ${message}`);
}
