import type { ExecutionPlan, Invocation, InvocationDependency, OutputDeclaration } from "./types.js";

export interface GraphLimits {
  maxInvocations: number;
  maxDependencies: number;
  maxDepth: number;
  maxFanOut: number;
}

export const DEFAULT_GRAPH_LIMITS: GraphLimits = {
  maxInvocations: 64,
  maxDependencies: 256,
  maxDepth: 16,
  maxFanOut: 16,
};

export type GraphValidationCode =
  | "DUPLICATE_INVOCATION"
  | "DUPLICATE_DEPENDENCY"
  | "UNKNOWN_SOURCE"
  | "UNKNOWN_TARGET"
  | "SELF_DEPENDENCY"
  | "CYCLE"
  | "DUPLICATE_OUTPUT"
  | "DUPLICATE_INPUT"
  | "MISSING_SOURCE_OUTPUT"
  | "ARTIFACT_TYPE_MISMATCH"
  | "INVALID_DATA_DEPENDENCY"
  | "INVALID_CONDITIONAL_BINDING"
  | "INVALID_JOIN"
  | "INVALID_OUTCOME"
  | "INVALID_EVALUATOR"
  | "INVALID_EVALUATOR_BINDING"
  | "UNREACHABLE_INVOCATION"
  | "GRAPH_LIMIT_EXCEEDED";

export class GraphValidationError extends Error {
  constructor(
    readonly code: GraphValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "GraphValidationError";
  }
}

export interface NormalizedExecutionGraph {
  plan: ExecutionPlan;
  invocationsById: ReadonlyMap<string, Invocation>;
  incomingByInvocationId: ReadonlyMap<string, readonly InvocationDependency[]>;
  outgoingByInvocationId: ReadonlyMap<string, readonly InvocationDependency[]>;
  topologicalOrder: readonly string[];
  depthByInvocationId: ReadonlyMap<string, number>;
}

function uniqueOutputs(invocation: Invocation): Map<string, OutputDeclaration> {
  const result = new Map<string, OutputDeclaration>();
  for (const output of invocation.outputs) {
    if (result.has(output.name)) {
      throw new GraphValidationError("DUPLICATE_OUTPUT", `Invocation ${invocation.id} declares output ${output.name} more than once`);
    }
    result.set(output.name, output);
  }
  return result;
}

function isValidJsonPointer(pointer: string): boolean {
  if (pointer === "") return true;
  if (!pointer.startsWith("/")) return false;
  return pointer
    .slice(1)
    .split("/")
    .every((token) => !/~(?![01])/u.test(token));
}

export function validateExecutionPlanGraph(
  plan: ExecutionPlan,
  limits: GraphLimits = DEFAULT_GRAPH_LIMITS,
): NormalizedExecutionGraph {
  if (plan.invocations.length > limits.maxInvocations || plan.dependencies.length > limits.maxDependencies) {
    throw new GraphValidationError("GRAPH_LIMIT_EXCEEDED", "Execution graph exceeds configured size limits");
  }

  const invocationsById = new Map<string, Invocation>();
  const outputsByInvocation = new Map<string, Map<string, OutputDeclaration>>();
  for (const invocation of plan.invocations) {
    if (invocationsById.has(invocation.id)) {
      throw new GraphValidationError("DUPLICATE_INVOCATION", `Duplicate invocation id ${invocation.id}`);
    }
    invocationsById.set(invocation.id, invocation);
    outputsByInvocation.set(invocation.id, uniqueOutputs(invocation));
  }

  const incoming = new Map<string, InvocationDependency[]>();
  const outgoing = new Map<string, InvocationDependency[]>();
  for (const id of invocationsById.keys()) {
    incoming.set(id, []);
    outgoing.set(id, []);
  }

  const dependencyIds = new Set<string>();
  const edgeKeys = new Set<string>();
  const boundInputs = new Map<string, Set<string>>();
  for (const dependency of plan.dependencies) {
    if (dependencyIds.has(dependency.id)) {
      throw new GraphValidationError(
        "DUPLICATE_DEPENDENCY",
        `Duplicate dependency id ${dependency.id}`,
      );
    }
    dependencyIds.add(dependency.id);
    if (!invocationsById.has(dependency.fromInvocationId)) {
      throw new GraphValidationError("UNKNOWN_SOURCE", `Unknown dependency source ${dependency.fromInvocationId}`);
    }
    if (!invocationsById.has(dependency.toInvocationId)) {
      throw new GraphValidationError("UNKNOWN_TARGET", `Unknown dependency target ${dependency.toInvocationId}`);
    }
    if (dependency.fromInvocationId === dependency.toInvocationId) {
      throw new GraphValidationError("SELF_DEPENDENCY", `Invocation ${dependency.fromInvocationId} cannot depend on itself`);
    }
    const edgeKey = `${dependency.fromInvocationId}->${dependency.toInvocationId}:${dependency.condition.kind}:${dependency.condition.kind === "OUTCOME" ? dependency.condition.outcome : ""}`;
    if (edgeKeys.has(edgeKey)) {
      throw new GraphValidationError("DUPLICATE_DEPENDENCY", `Duplicate dependency ${edgeKey}`);
    }
    edgeKeys.add(edgeKey);

    if (dependency.condition.kind === "OUTCOME" && dependency.condition.outcome.trim().length === 0) {
      throw new GraphValidationError("INVALID_OUTCOME", `Outcome dependency ${dependency.id} must name an outcome`);
    }
    if (dependency.condition.kind === "OUTCOME") {
      const source = invocationsById.get(dependency.fromInvocationId);
      if (
        source?.target.kind === "EVALUATOR" &&
        dependency.condition.outcome !== "PASS" &&
        dependency.condition.outcome !== "FAIL"
      ) {
        throw new GraphValidationError(
          "INVALID_OUTCOME",
          `Evaluator outcome dependency ${dependency.id} must use PASS or FAIL`,
        );
      }
    }
    if (dependency.condition.kind === "DATA" && dependency.inputBindings.length === 0) {
      throw new GraphValidationError("INVALID_DATA_DEPENDENCY", `Data dependency ${dependency.id} must bind at least one artifact`);
    }
    if (dependency.condition.kind !== "DATA" && dependency.inputBindings.length > 0) {
      throw new GraphValidationError("INVALID_CONDITIONAL_BINDING", `Only DATA dependencies may bind artifacts (${dependency.id})`);
    }

    const sourceOutputs = outputsByInvocation.get(dependency.fromInvocationId);
    const incomingDependencies = incoming.get(dependency.toInvocationId);
    const outgoingDependencies = outgoing.get(dependency.fromInvocationId);
    if (!sourceOutputs || !incomingDependencies || !outgoingDependencies) {
      throw new GraphValidationError("UNKNOWN_SOURCE", `Dependency ${dependency.id} references an unknown invocation`);
    }

    const targetInputs = boundInputs.get(dependency.toInvocationId) ?? new Set<string>();
    for (const binding of dependency.inputBindings) {
      if (targetInputs.has(binding.inputName)) {
        throw new GraphValidationError("DUPLICATE_INPUT", `Invocation ${dependency.toInvocationId} binds input ${binding.inputName} more than once`);
      }
      const output = sourceOutputs.get(binding.sourceOutputName);
      if (!output) {
        throw new GraphValidationError("MISSING_SOURCE_OUTPUT", `Dependency ${dependency.id} references missing output ${binding.sourceOutputName}`);
      }
      if (output.artifactType !== binding.expectedArtifactType) {
        throw new GraphValidationError(
          "ARTIFACT_TYPE_MISMATCH",
          `Dependency ${dependency.id} expects ${binding.expectedArtifactType} but ${binding.sourceOutputName} is ${output.artifactType}`,
        );
      }
      targetInputs.add(binding.inputName);
    }
    boundInputs.set(dependency.toInvocationId, targetInputs);

    incomingDependencies.push(dependency);
    outgoingDependencies.push(dependency);
  }

  for (const [id, deps] of outgoing) {
    if (deps.length > limits.maxFanOut) {
      throw new GraphValidationError("GRAPH_LIMIT_EXCEEDED", `Invocation ${id} exceeds max fan-out ${limits.maxFanOut}`);
    }
  }

  for (const invocation of plan.invocations) {
    const incomingDependencies = incoming.get(invocation.id);
    if (!incomingDependencies) {
      throw new GraphValidationError("UNREACHABLE_INVOCATION", `Invocation ${invocation.id} is not present in normalized graph`);
    }
    if (incomingDependencies.length < 2 && invocation.joinPolicy !== "ALL_REQUIRED") {
      throw new GraphValidationError("INVALID_JOIN", `Invocation ${invocation.id} uses ${invocation.joinPolicy} without a multi-edge join`);
    }

    if (invocation.target.kind === "EVALUATOR") {
      if (
        invocation.outputs.length !== 1 ||
        invocation.outputs[0]?.artifactType !== "JSON" ||
        invocation.acceptanceCriteria.length === 0
      ) {
        throw new GraphValidationError(
          "INVALID_EVALUATOR",
          `Evaluator ${invocation.id} must declare one JSON output and at least one acceptance criterion`,
        );
      }
      const criterionIds = new Set<string>();
      for (const criterion of invocation.acceptanceCriteria) {
        if (criterionIds.has(criterion.id)) {
          throw new GraphValidationError(
            "INVALID_EVALUATOR",
            `Evaluator ${invocation.id} declares duplicate acceptance criterion ${criterion.id}`,
          );
        }
        criterionIds.add(criterion.id);
      }

      const modes = new Set(
        invocation.acceptanceCriteria.map((criterion) => criterion.mode),
      );
      if (modes.size !== 1) {
        throw new GraphValidationError(
          "INVALID_EVALUATOR",
          `Evaluator ${invocation.id} cannot mix evaluation modes`,
        );
      }
      const mode = invocation.acceptanceCriteria[0]?.mode;
      if (
        mode === "DETERMINISTIC" &&
        invocation.acceptanceCriteria.some(
          (criterion) => criterion.binding === undefined,
        )
      ) {
        throw new GraphValidationError(
          "INVALID_EVALUATOR",
          `Deterministic evaluator ${invocation.id} requires bindings for every criterion`,
        );
      }
      if (
        mode !== "DETERMINISTIC" &&
        invocation.acceptanceCriteria.some(
          (criterion) => criterion.binding !== undefined,
        )
      ) {
        throw new GraphValidationError(
          "INVALID_EVALUATOR",
          `Only deterministic evaluator ${invocation.id} may declare deterministic bindings`,
        );
      }

      const availableInputs = boundInputs.get(invocation.id) ?? new Set<string>();
      for (const criterion of invocation.acceptanceCriteria) {
        if (
          criterion.binding?.kind === "JSON_EQUALS" &&
          !isValidJsonPointer(criterion.binding.path)
        ) {
          throw new GraphValidationError(
            "INVALID_EVALUATOR_BINDING",
            `Evaluator criterion ${criterion.id} contains an invalid JSON pointer`,
          );
        }
        if (
          criterion.binding &&
          !availableInputs.has(criterion.binding.inputName)
        ) {
          throw new GraphValidationError(
            "INVALID_EVALUATOR_BINDING",
            `Evaluator criterion ${criterion.id} references unbound input ${criterion.binding.inputName}`,
          );
        }
      }
    }
  }

  const indegree = new Map<string, number>();
  for (const [id, deps] of incoming) indegree.set(id, deps.length);
  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  const order: string[] = [];
  const depth = new Map<string, number>(queue.map((id) => [id, 0]));

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    if (id === undefined) continue;
    order.push(id);
    const currentDepth = depth.get(id) ?? 0;
    for (const dependency of outgoing.get(id) ?? []) {
      const next = dependency.toInvocationId;
      depth.set(next, Math.max(depth.get(next) ?? 0, currentDepth + 1));
      const nextDegree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextDegree);
      if (nextDegree === 0) queue.push(next);
    }
  }

  if (order.length !== plan.invocations.length) {
    throw new GraphValidationError("CYCLE", "Execution graph must be acyclic");
  }

  for (const invocation of plan.invocations) {
    const nodeDepth = depth.get(invocation.id);
    if (nodeDepth === undefined) {
      throw new GraphValidationError("UNREACHABLE_INVOCATION", `Invocation ${invocation.id} is unreachable`);
    }
    if (nodeDepth > limits.maxDepth) {
      throw new GraphValidationError("GRAPH_LIMIT_EXCEEDED", `Execution graph exceeds max depth ${limits.maxDepth}`);
    }
  }

  return {
    plan,
    invocationsById,
    incomingByInvocationId: incoming,
    outgoingByInvocationId: outgoing,
    topologicalOrder: order,
    depthByInvocationId: depth,
  };
}
