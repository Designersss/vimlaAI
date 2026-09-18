export const PLAN_STATUSES = [
  "PLANNING",
  "PLANNED",
  "RUNNING",
  "PARTIAL",
  "COMPLETED",
  "FAILED",
  "CANCELED",
] as const;

export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const INVOCATION_STATUSES = [
  "PENDING",
  "READY",
  "RUNNING",
  "WAITING_APPROVAL",
  "WAITING_FOR_USAGE_CAPACITY",
  "BLOCKED_INSUFFICIENT_USAGE",
  "COMPLETED",
  "FAILED",
  "SKIPPED",
  "CANCELED",
] as const;

export type InvocationStatus = (typeof INVOCATION_STATUSES)[number];

const TERMINAL_PLAN_STATUSES: ReadonlySet<PlanStatus> = new Set([
  "PARTIAL",
  "COMPLETED",
  "FAILED",
  "CANCELED",
]);

const TERMINAL_INVOCATION_STATUSES: ReadonlySet<InvocationStatus> = new Set([
  "COMPLETED",
  "FAILED",
  "SKIPPED",
  "CANCELED",
]);

export function isTerminalPlanStatus(status: PlanStatus): boolean {
  return TERMINAL_PLAN_STATUSES.has(status);
}

export function isTerminalInvocationStatus(status: InvocationStatus): boolean {
  return TERMINAL_INVOCATION_STATUSES.has(status);
}
