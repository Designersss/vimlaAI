import { BadRequestException } from "@nestjs/common";
import type {
  DependencyConditionDefinition,
  ExecutionPlanDefinition,
  InvocationDefinition,
  InvocationDependencyDefinition,
  InvocationStatus,
} from "./contracts.js";

interface SourceState {
  status: InvocationStatus;
  outcome?: string | null;
}

type DependencyEvaluation = "WAITING" | "SATISFIED" | "IMPOSSIBLE";

export function validateManualExecutionPlan(plan: ExecutionPlanDefinition): void {
  const invocations = new Map<string, InvocationDefinition>();
  const outputs = new Map<string, Map<string, string>>();

  for (const invocation of plan.invocations) {
    if (invocations.has(invocation.id)) {
      invalid(`Duplicate invocation id ${invocation.id}`);
    }
    invocations.set(invocation.id, invocation);

    if (
      invocation.approvalPolicy === "AUTO" &&
      (invocation.riskClass === "EXTERNAL_SIDE_EFFECT" ||
        invocation.riskClass === "DESTRUCTIVE" ||
        invocation.riskClass === "FINANCIAL")
    ) {
      invalid(
        `Invocation ${invocation.id} requires explicit approval for risk class ${invocation.riskClass}`,
      );
    }

    const declared = new Map<string, string>();
    for (const output of invocation.outputs) {
      if (declared.has(output.name)) {
        invalid(`Invocation ${invocation.id} declares output ${output.name} more than once`);
      }
      declared.set(output.name, output.artifactType);
    }
    outputs.set(invocation.id, declared);
  }

  const incoming = new Map<string, InvocationDependencyDefinition[]>();
  const outgoing = new Map<string, InvocationDependencyDefinition[]>();
  for (const invocation of plan.invocations) {
    incoming.set(invocation.id, []);
    outgoing.set(invocation.id, []);
  }

  const dependencyIds = new Set<string>();
  const edgeKeys = new Set<string>();
  const boundInputs = new Map<string, Set<string>>();

  for (const dependency of plan.dependencies) {
    if (dependencyIds.has(dependency.id)) {
      invalid(`Duplicate dependency id ${dependency.id}`);
    }
    dependencyIds.add(dependency.id);

    if (!invocations.has(dependency.fromInvocationId)) {
      invalid(`Unknown dependency source ${dependency.fromInvocationId}`);
    }
    if (!invocations.has(dependency.toInvocationId)) {
      invalid(`Unknown dependency target ${dependency.toInvocationId}`);
    }
    if (dependency.fromInvocationId === dependency.toInvocationId) {
      invalid(`Invocation ${dependency.fromInvocationId} cannot depend on itself`);
    }

    const outcome = dependency.condition.kind === "OUTCOME" ? dependency.condition.outcome : "";
    const edgeKey = `${dependency.fromInvocationId}->${dependency.toInvocationId}:${dependency.condition.kind}:${outcome}`;
    if (edgeKeys.has(edgeKey)) {
      invalid(`Duplicate dependency ${edgeKey}`);
    }
    edgeKeys.add(edgeKey);

    if (dependency.condition.kind === "DATA" && dependency.inputBindings.length === 0) {
      invalid(`DATA dependency ${dependency.id} must bind at least one artifact`);
    }
    if (dependency.condition.kind !== "DATA" && dependency.inputBindings.length > 0) {
      invalid(`Only DATA dependencies may bind artifacts (${dependency.id})`);
    }

    const sourceOutputs = outputs.get(dependency.fromInvocationId);
    if (!sourceOutputs) {
      invalid(`Unknown dependency source ${dependency.fromInvocationId}`);
    }
    const targetInputs = boundInputs.get(dependency.toInvocationId) ?? new Set<string>();
    for (const binding of dependency.inputBindings) {
      if (targetInputs.has(binding.inputName)) {
        invalid(`Invocation ${dependency.toInvocationId} binds input ${binding.inputName} more than once`);
      }
      const actualType = sourceOutputs.get(binding.sourceOutputName);
      if (!actualType) {
        invalid(`Dependency ${dependency.id} references missing output ${binding.sourceOutputName}`);
      }
      if (actualType !== binding.expectedArtifactType) {
        invalid(
          `Dependency ${dependency.id} expects ${binding.expectedArtifactType} but ${binding.sourceOutputName} is ${actualType}`,
        );
      }
      targetInputs.add(binding.inputName);
    }
    boundInputs.set(dependency.toInvocationId, targetInputs);

    incoming.get(dependency.toInvocationId)?.push(dependency);
    outgoing.get(dependency.fromInvocationId)?.push(dependency);
  }

  for (const invocation of plan.invocations) {
    const edges = incoming.get(invocation.id) ?? [];
    if (edges.length < 2 && invocation.joinPolicy !== "ALL_REQUIRED") {
      invalid(`Invocation ${invocation.id} uses ${invocation.joinPolicy} without a multi-edge join`);
    }
    if ((outgoing.get(invocation.id)?.length ?? 0) > 16) {
      invalid(`Invocation ${invocation.id} exceeds max fan-out 16`);
    }
  }

  const indegree = new Map<string, number>();
  for (const [id, edges] of incoming) {
    indegree.set(id, edges.length);
  }
  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id);
  const depth = new Map<string, number>(queue.map((id) => [id, 0]));
  let visited = 0;

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    if (!id) continue;
    visited += 1;
    const currentDepth = depth.get(id) ?? 0;
    for (const dependency of outgoing.get(id) ?? []) {
      const next = dependency.toInvocationId;
      depth.set(next, Math.max(depth.get(next) ?? 0, currentDepth + 1));
      const nextDegree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextDegree);
      if (nextDegree === 0) {
        queue.push(next);
      }
    }
  }

  if (visited !== plan.invocations.length) {
    invalid("Execution graph must be acyclic");
  }
  if ([...depth.values()].some((value) => value > 16)) {
    invalid("Execution graph exceeds max depth 16");
  }
}

export function initialInvocationStatuses(
  plan: ExecutionPlanDefinition,
): Map<string, InvocationStatus> {
  const incoming = new Map<string, InvocationDependencyDefinition[]>();
  for (const invocation of plan.invocations) {
    incoming.set(invocation.id, []);
  }
  for (const dependency of plan.dependencies) {
    incoming.get(dependency.toInvocationId)?.push(dependency);
  }

  const result = new Map<string, InvocationStatus>();
  const states = new Map<string, SourceState>(
    plan.invocations.map((invocation) => [invocation.id, { status: "PENDING" }]),
  );

  for (const invocation of plan.invocations) {
    const decision = decideReadiness(invocation, incoming.get(invocation.id) ?? [], states);
    if (decision === "READY") {
      result.set(
        invocation.id,
        invocation.approvalPolicy === "AUTO" ? "READY" : "WAITING_APPROVAL",
      );
    } else {
      result.set(invocation.id, decision);
    }
  }
  return result;
}

function decideReadiness(
  invocation: InvocationDefinition,
  dependencies: readonly InvocationDependencyDefinition[],
  sourceStates: ReadonlyMap<string, SourceState>,
): "PENDING" | "READY" | "SKIPPED" {
  if (dependencies.length === 0) {
    return "READY";
  }

  const evaluations = dependencies.map((dependency) => {
    const source = sourceStates.get(dependency.fromInvocationId);
    if (!source) return "WAITING" as const;
    return evaluateCondition(dependency.condition, source);
  });

  if (invocation.joinPolicy === "ALL_SETTLED") {
    return evaluations.every((value) => value !== "WAITING") ? "READY" : "PENDING";
  }
  if (invocation.joinPolicy === "ANY_REQUIRED") {
    if (evaluations.some((value) => value === "SATISFIED")) return "READY";
    if (evaluations.every((value) => value === "IMPOSSIBLE")) return "SKIPPED";
    return "PENDING";
  }
  if (evaluations.some((value) => value === "IMPOSSIBLE")) return "SKIPPED";
  if (evaluations.every((value) => value === "SATISFIED")) return "READY";
  return "PENDING";
}

function evaluateCondition(
  condition: DependencyConditionDefinition,
  source: SourceState,
): DependencyEvaluation {
  if (!isTerminal(source.status)) return "WAITING";

  switch (condition.kind) {
    case "ALWAYS":
      return "SATISFIED";
    case "DATA":
    case "ON_SUCCESS":
      return source.status === "COMPLETED" ? "SATISFIED" : "IMPOSSIBLE";
    case "ON_FAILURE":
      return source.status === "FAILED" ? "SATISFIED" : "IMPOSSIBLE";
    case "OUTCOME":
      return source.status === "COMPLETED" && source.outcome === condition.outcome
        ? "SATISFIED"
        : "IMPOSSIBLE";
  }
}

function isTerminal(status: InvocationStatus): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "SKIPPED" || status === "CANCELED";
}

function invalid(message: string): never {
  throw new BadRequestException({ code: "validation_error", message });
}
