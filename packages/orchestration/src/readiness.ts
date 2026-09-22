import type { DependencyCondition } from "./dependencies.js";
import { isTerminalInvocationStatus } from "./states.js";
import type { InvocationStatus } from "./states.js";
import type { Invocation, InvocationDependency, JoinPolicy } from "./types.js";

export interface DependencySourceRuntimeState {
  invocationId: string;
  status: InvocationStatus;
  outcome?: string | null;
}

export type ReadinessDecision = "PENDING" | "READY" | "SKIPPED";

export interface InvocationReadinessResult {
  decision: ReadinessDecision;
  reason: string;
}

type DependencyEvaluation = "WAITING" | "SATISFIED" | "IMPOSSIBLE";

function evaluateCondition(
  condition: DependencyCondition,
  source: DependencySourceRuntimeState,
): DependencyEvaluation {
  if (!isTerminalInvocationStatus(source.status)) return "WAITING";

  switch (condition.kind) {
    case "ALWAYS":
      return "SATISFIED";
    case "DATA":
    case "ON_SUCCESS":
      return source.status === "COMPLETED" ? "SATISFIED" : "IMPOSSIBLE";
    case "ON_FAILURE":
      return source.status === "FAILED" ? "SATISFIED" : "IMPOSSIBLE";
    case "OUTCOME":
      return source.status === "COMPLETED" && source.outcome === condition.outcome ? "SATISFIED" : "IMPOSSIBLE";
  }
}

function decideJoin(policy: JoinPolicy, evaluations: readonly DependencyEvaluation[]): InvocationReadinessResult {
  if (evaluations.length === 0) {
    return { decision: "READY", reason: "root invocation has no dependencies" };
  }

  if (policy === "ALL_SETTLED") {
    return evaluations.every((value) => value !== "WAITING")
      ? { decision: "READY", reason: "all upstream invocations are terminal" }
      : { decision: "PENDING", reason: "waiting for upstream invocations to settle" };
  }

  if (policy === "ANY_REQUIRED") {
    if (evaluations.some((value) => value === "SATISFIED")) {
      return { decision: "READY", reason: "at least one dependency is satisfied" };
    }
    if (evaluations.every((value) => value === "IMPOSSIBLE")) {
      return { decision: "SKIPPED", reason: "no dependency can be satisfied" };
    }
    return { decision: "PENDING", reason: "waiting for a satisfiable dependency" };
  }

  if (evaluations.some((value) => value === "IMPOSSIBLE")) {
    return { decision: "SKIPPED", reason: "a required dependency cannot be satisfied" };
  }
  if (evaluations.every((value) => value === "SATISFIED")) {
    return { decision: "READY", reason: "all required dependencies are satisfied" };
  }
  return { decision: "PENDING", reason: "waiting for required dependencies" };
}

export function decideDependencyReadiness(
  joinPolicy: JoinPolicy,
  incomingDependencies: readonly Pick<
    InvocationDependency,
    "fromInvocationId" | "condition"
  >[],
  sourceStates: ReadonlyMap<string, DependencySourceRuntimeState>,
): InvocationReadinessResult {
  const evaluations = incomingDependencies.map((dependency) => {
    const source = sourceStates.get(dependency.fromInvocationId);
    if (!source) return "WAITING" as const;
    return evaluateCondition(dependency.condition, source);
  });

  return decideJoin(joinPolicy, evaluations);
}

export function decideInvocationReadiness(
  invocation: Invocation,
  incomingDependencies: readonly InvocationDependency[],
  sourceStates: ReadonlyMap<string, DependencySourceRuntimeState>,
): InvocationReadinessResult {
  return decideDependencyReadiness(
    invocation.joinPolicy,
    incomingDependencies,
    sourceStates,
  );
}

export function computePendingInvocationTransitions(
  invocations: readonly Invocation[],
  dependencies: readonly InvocationDependency[],
  runtimeStates: ReadonlyMap<string, DependencySourceRuntimeState>,
): ReadonlyMap<string, InvocationReadinessResult> {
  const incoming = new Map<string, InvocationDependency[]>();
  for (const invocation of invocations) incoming.set(invocation.id, []);
  for (const dependency of dependencies) {
    incoming.get(dependency.toInvocationId)?.push(dependency);
  }

  const results = new Map<string, InvocationReadinessResult>();
  for (const invocation of invocations) {
    const current = runtimeStates.get(invocation.id);
    if (current?.status !== undefined && current.status !== "PENDING") continue;
    results.set(
      invocation.id,
      decideInvocationReadiness(invocation, incoming.get(invocation.id) ?? [], runtimeStates),
    );
  }
  return results;
}
