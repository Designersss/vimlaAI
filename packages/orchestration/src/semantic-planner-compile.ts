import {
  invocationTargetForPlannerMention,
  type PlannerInvocationMention,
} from "./planner-mentions.js";
import { validateExecutionPlanGraph } from "./graph.js";
import { executionPlanSchema } from "./plan-schema.js";
import {
  SEMANTIC_PLANNER_LIMITS,
  SemanticPlannerError,
  type SemanticPlannerDraft,
  type SemanticPlannerTargetHint,
  type SemanticWorkflowPlannerInput,
  type SemanticWorkflowPlannerResult,
} from "./semantic-planner-contract.js";
import type { ExecutionPlan, InvocationDependency } from "./types.js";

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
    dependencies: draft.dependencies.map((dependency) => ({ ...dependency })),
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

  validateGraph(provisional);

  const normalized = normalizeSemanticExecutionPlan(provisional);
  const parsed = executionPlanSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new SemanticPlannerError("GRAPH_INVALID", parsed.error.message);
  }
  validateGraph(parsed.data);

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

  const invocationById = new Map(
    plan.invocations.map((invocation) => [invocation.id, invocation]),
  );
  const invocations = order.map((originalId) => {
    const invocation = invocationById.get(originalId);
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

function validateGraph(plan: ExecutionPlan): void {
  try {
    validateExecutionPlanGraph(plan);
  } catch (error: unknown) {
    throw new SemanticPlannerError(
      "GRAPH_INVALID",
      error instanceof Error ? error.message : "Planner proposed an invalid graph",
    );
  }
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
