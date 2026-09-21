import type { useTranslations } from "next-intl";
import type {
  WorkflowDependency,
  WorkflowInvocation,
  WorkflowInvocationStatus,
  WorkflowPlanStatus,
} from "@vimla/contracts";
import { tx } from "../../../shared/i18n/translate";

type Translate = ReturnType<typeof useTranslations>;

export const TERMINAL_PLAN_STATUSES = new Set<WorkflowPlanStatus>([
  "NEEDS_CLARIFICATION",
  "PARTIAL",
  "COMPLETED",
  "FAILED",
  "CANCELED",
]);

export const TERMINAL_INVOCATION_STATUSES = new Set<WorkflowInvocationStatus>([
  "COMPLETED",
  "FAILED",
  "SKIPPED",
  "CANCELED",
]);

export function planStatusVariant(
  status: WorkflowPlanStatus,
): "neutral" | "accent" | "success" | "warning" | "danger" {
  if (status === "COMPLETED") return "success";
  if (status === "FAILED") return "danger";
  if (
    status === "NEEDS_CLARIFICATION" ||
    status === "PARTIAL" ||
    status === "CANCELED"
  ) return "warning";
  if (status === "RUNNING") return "accent";
  return "neutral";
}

export function invocationStatusVariant(
  status: WorkflowInvocationStatus,
): "neutral" | "accent" | "success" | "warning" | "danger" {
  if (status === "COMPLETED") return "success";
  if (status === "FAILED") return "danger";
  if (
    status === "WAITING_APPROVAL" ||
    status === "WAITING_FOR_USAGE_CAPACITY" ||
    status === "BLOCKED_INSUFFICIENT_USAGE"
  ) {
    return "warning";
  }
  if (status === "RUNNING") return "accent";
  return "neutral";
}

export function planStatusLabel(
  t: Translate,
  status: WorkflowPlanStatus,
): string {
  return tx(t, `workflow.planStatus.${status}`);
}

export function invocationStatusLabel(
  t: Translate,
  status: WorkflowInvocationStatus,
): string {
  return tx(t, `workflow.invocationStatus.${status}`);
}

export function targetLabel(
  invocation: WorkflowInvocation,
  t: Translate,
): string {
  switch (invocation.target.kind) {
    case "VIMLA":
      return "Vimla";
    case "AI_AUTO":
      return tx(t, "workflow.targetAuto");
    case "AI_MODEL":
      return invocation.target.modelSlug;
    case "EVALUATOR":
      return tx(t, "workflow.targetEvaluator");
    case "AGENT":
      return tx(t, "workflow.targetAgent");
  }
}

export function invocationStatusDetail(
  invocation: WorkflowInvocation,
  t: Translate,
): string | null {
  if (invocation.status === "WAITING_FOR_USAGE_CAPACITY") {
    return tx(t, "workflow.waitingCapacity");
  }
  if (invocation.status === "BLOCKED_INSUFFICIENT_USAGE") {
    return tx(t, "workflow.blockedUsage");
  }
  if (invocation.status === "WAITING_APPROVAL") {
    return tx(t, "workflow.waitingApproval");
  }
  if (invocation.status === "FAILED") {
    return workflowFailureLabel(invocation.latestRun?.errorCode ?? null, t);
  }
  return null;
}

export function dependencyLabel(
  dependency: WorkflowDependency,
  sourcePurpose: string,
  t: Translate,
): string {
  switch (dependency.condition.kind) {
    case "DATA":
      return tx(t, "workflow.dependencyData", { source: sourcePurpose });
    case "ON_SUCCESS":
      return tx(t, "workflow.dependencySuccess", { source: sourcePurpose });
    case "ON_FAILURE":
      return tx(t, "workflow.dependencyFailure", { source: sourcePurpose });
    case "ALWAYS":
      return tx(t, "workflow.dependencyAlways", { source: sourcePurpose });
    case "OUTCOME":
      return tx(t, "workflow.dependencyOutcome", {
        source: sourcePurpose,
        outcome: dependency.condition.outcome,
      });
  }
}

export function latestRunSummary(
  invocation: WorkflowInvocation,
  t: Translate,
): string | null {
  const run = invocation.latestRun;
  if (!run) return null;

  const parts = [tx(t, "workflow.attempt", { attempt: run.attempt })];
  if (run.outcome) {
    parts.push(tx(t, "workflow.outcome", { outcome: run.outcome }));
  }

  if (run.startedAt && run.finishedAt) {
    const started = Date.parse(run.startedAt);
    const finished = Date.parse(run.finishedAt);
    if (Number.isFinite(started) && Number.isFinite(finished) && finished >= started) {
      const durationMs = finished - started;
      parts.push(
        durationMs >= 1_000
          ? tx(t, "workflow.durationSeconds", {
              seconds: Math.round(durationMs / 100) / 10,
            })
          : tx(t, "workflow.durationMs", { milliseconds: durationMs }),
      );
    }
  }

  return parts.join(" · ");
}

function workflowFailureLabel(
  errorCode: string | null,
  t: Translate,
): string {
  if (errorCode === "PLAN_SPEND_LIMIT_REACHED") {
    return tx(t, "workflow.failureSpendLimit");
  }
  if (
    errorCode === "AI_RECONCILIATION_REQUIRED" ||
    errorCode === "AI_PROVIDER_BOUNDEDNESS_VIOLATION"
  ) {
    return tx(t, "workflow.failureReconciliation");
  }
  if (errorCode === "AI_PROVIDER_INTERRUPTED") {
    return tx(t, "workflow.failureInterrupted");
  }
  return tx(t, "workflow.failureGeneric");
}
