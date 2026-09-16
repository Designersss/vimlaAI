export const DEPENDENCY_CONDITION_KINDS = ["DATA", "ON_SUCCESS", "ON_FAILURE", "ALWAYS", "OUTCOME"] as const;

export type DependencyConditionKind = (typeof DEPENDENCY_CONDITION_KINDS)[number];

export type DependencyCondition =
  | { kind: "DATA" }
  | { kind: "ON_SUCCESS" }
  | { kind: "ON_FAILURE" }
  | { kind: "ALWAYS" }
  | { kind: "OUTCOME"; outcome: string };

export function isDataDependencyCondition(condition: DependencyCondition): condition is { kind: "DATA" } {
  return condition.kind === "DATA";
}

export function isOutcomeDependencyCondition(
  condition: DependencyCondition,
): condition is Extract<DependencyCondition, { kind: "OUTCOME" }> {
  return condition.kind === "OUTCOME";
}
