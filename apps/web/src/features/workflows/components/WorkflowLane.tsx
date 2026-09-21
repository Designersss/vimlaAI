"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  Progress,
  Text,
} from "@vimla/ui";
import type {
  ExecutionPlanView,
  WorkflowDependency,
  WorkflowInvocation,
  WorkflowInvocationStatus,
  WorkflowPlanStatus,
} from "@vimla/contracts";
import { AuthRequiredError } from "../../auth/services/current-user";
import {
  WorkflowRequestError,
  approveExecutionPlanInvocation,
  fetchConversationWorkflows,
  startExecutionPlan,
  stopExecutionPlan,
} from "../services/workflows";
import styles from "./WorkflowLane.module.scss";

const TERMINAL_PLAN_STATUSES = new Set<WorkflowPlanStatus>([
  "PARTIAL",
  "COMPLETED",
  "FAILED",
  "CANCELED",
]);

const TERMINAL_INVOCATION_STATUSES = new Set<WorkflowInvocationStatus>([
  "COMPLETED",
  "FAILED",
  "SKIPPED",
  "CANCELED",
]);

export function WorkflowLane({
  conversationId,
}: {
  conversationId: string;
}): ReactElement | null {
  const t = useTranslations();
  const router = useRouter();
  const [plans, setPlans] = useState<ExecutionPlanView[]>([]);
  const [failed, setFailed] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await fetchConversationWorkflows(conversationId);
      setPlans(response.plans);
      setFailed(false);
    } catch (error: unknown) {
      if (error instanceof AuthRequiredError) {
        router.replace("/sign-in");
        return;
      }
      setFailed(true);
    }
  }, [conversationId, router]);

  useEffect(() => {
    let cancelled = false;
    void fetchConversationWorkflows(conversationId)
      .then((response) => {
        if (cancelled) return;
        setPlans(response.plans);
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof AuthRequiredError) {
          router.replace("/sign-in");
          return;
        }
        setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, router]);

  const hasActivePlan = useMemo(
    () => plans.some((plan) => !TERMINAL_PLAN_STATUSES.has(plan.status)),
    [plans],
  );

  useEffect(() => {
    if (!hasActivePlan) return;

    let cancelled = false;
    const timer = window.setInterval(() => {
      if (cancelled || document.visibilityState !== "visible") return;
      void refresh();
    }, 3_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasActivePlan, refresh]);

  const visiblePlans = useMemo(() => {
    const active = plans.filter(
      (plan) => !TERMINAL_PLAN_STATUSES.has(plan.status),
    );
    if (active.length > 0) return active;
    const latest = plans.at(-1);
    return latest ? [latest] : [];
  }, [plans]);

  async function mutate(
    key: string,
    action: () => Promise<ExecutionPlanView>,
  ): Promise<void> {
    if (busyKey) return;
    setBusyKey(key);
    try {
      const updated = await action();
      setPlans((current) =>
        current.map((plan) => (plan.id === updated.id ? updated : plan)),
      );
      setFailed(false);
    } catch (error: unknown) {
      if (error instanceof AuthRequiredError) {
        router.replace("/sign-in");
        return;
      }
      setFailed(true);
      if (error instanceof WorkflowRequestError) {
        void refresh();
      }
    } finally {
      setBusyKey(null);
    }
  }

  if (visiblePlans.length === 0 && !failed) return null;

  return (
    <aside
      className={styles.lane}
      aria-label={t("workflow.region")}
      data-testid="workflow-lane"
    >
      {failed ? (
        <div className={styles.failure} role="status">
          <Text tone="secondary">{t("workflow.loadFailed")}</Text>
          <Button size="sm" variant="ghost" onClick={() => void refresh()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}

      {visiblePlans.map((plan) => (
        <WorkflowCard
          key={plan.id}
          plan={plan}
          busyKey={busyKey}
          onStart={() =>
            void mutate(`start:${plan.id}`, () => startExecutionPlan(plan.id))
          }
          onStop={() =>
            void mutate(`stop:${plan.id}`, () => stopExecutionPlan(plan.id))
          }
          onApprove={(invocationId) =>
            void mutate(`approve:${plan.id}:${invocationId}`, () =>
              approveExecutionPlanInvocation(plan.id, invocationId),
            )
          }
        />
      ))}
    </aside>
  );
}

function WorkflowCard({
  plan,
  busyKey,
  onStart,
  onStop,
  onApprove,
}: {
  plan: ExecutionPlanView;
  busyKey: string | null;
  onStart: () => void;
  onStop: () => void;
  onApprove: (invocationId: string) => void;
}): ReactElement {
  const t = useTranslations();
  const completed = plan.invocations.filter((invocation) =>
    TERMINAL_INVOCATION_STATUSES.has(invocation.status),
  ).length;
  const progress =
    plan.invocations.length === 0
      ? 0
      : Math.round((completed / plan.invocations.length) * 100);

  return (
    <Card className={styles.card} data-testid="workflow-card">
      <div className={styles.header}>
        <div className={styles.heading}>
          <div className={styles.eyebrow}>
            <Text tone="caption">{t("workflow.title")}</Text>
            <WorkflowStatusBadge status={plan.status} />
          </div>
          <strong className={styles.goal}>{plan.goal}</strong>
          <Text tone="caption">
            {t("workflow.progress", {
              completed,
              total: plan.invocations.length,
            })}
          </Text>
        </div>
        <div className={styles.actions}>
          {plan.status === "PLANNED" ? (
            <Button
              size="sm"
              variant="primary"
              onClick={onStart}
              disabled={busyKey !== null}
              loading={busyKey === `start:${plan.id}`}
            >
              {t("workflow.start")}
            </Button>
          ) : null}
          {plan.status === "PLANNED" || plan.status === "RUNNING" ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onStop}
              disabled={busyKey !== null}
              loading={busyKey === `stop:${plan.id}`}
            >
              {t("workflow.stop")}
            </Button>
          ) : null}
        </div>
      </div>

      <Progress value={progress} label={t("workflow.progressLabel")} />

      <ol className={styles.steps}>
        {plan.invocations.map((invocation, index) => (
          <WorkflowStep
            key={invocation.id}
            index={index}
            planId={plan.id}
            invocation={invocation}
            incomingDependencies={plan.dependencies.filter(
              (dependency) => dependency.toInvocationId === invocation.id,
            )}
            sourceInvocations={plan.invocations}
            busyKey={busyKey}
            onApprove={onApprove}
          />
        ))}
      </ol>
    </Card>
  );
}

function WorkflowStep({
  index,
  planId,
  invocation,
  incomingDependencies,
  sourceInvocations,
  busyKey,
  onApprove,
}: {
  index: number;
  planId: string;
  invocation: WorkflowInvocation;
  incomingDependencies: WorkflowDependency[];
  sourceInvocations: WorkflowInvocation[];
  busyKey: string | null;
  onApprove: (invocationId: string) => void;
}): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const approveKey = `approve:${planId}:${invocation.id}`;
  const detail = invocationStatusDetail(invocation, t);

  return (
    <li className={styles.step} data-status={invocation.status}>
      <span className={styles.stepIndex} aria-hidden="true">
        {index + 1}
      </span>
      <div className={styles.stepBody}>
        <div className={styles.stepTop}>
          <strong className={styles.stepPurpose}>{invocation.purpose}</strong>
          <div className={styles.stepBadges}>
            <Badge variant="neutral">{targetLabel(invocation, t)}</Badge>
            <InvocationStatusBadge status={invocation.status} />
          </div>
        </div>

        {detail ? <Text tone="caption">{detail}</Text> : null}

        {incomingDependencies.length > 0 ? (
          <div className={styles.dependencies}>
            {incomingDependencies.map((dependency) => {
              const source = sourceInvocations.find(
                (candidate) => candidate.id === dependency.fromInvocationId,
              );
              return (
                <Text tone="caption" key={dependency.id}>
                  {dependencyLabel(dependency, source?.purpose ?? dependency.fromInvocationId, t)}
                </Text>
              );
            })}
          </div>
        ) : null}

        {invocation.artifacts.length > 0 ? (
          <div
            className={styles.artifacts}
            aria-label={t("workflow.artifacts")}
          >
            {invocation.artifacts.map((artifact) => (
              <details
                className={styles.artifact}
                key={artifact.artifactVersionId}
              >
                <summary>
                  {artifact.outputName} · {artifact.type}
                </summary>
                <div className={styles.artifactDetails}>
                  <Text tone="caption">
                    {t("workflow.artifactVersion" as never, {
                      version: artifact.version,
                    })}
                  </Text>
                  <Text tone="caption">
                    {t("workflow.artifactClassification" as never, {
                      classification: artifact.classification,
                    })}
                  </Text>
                  <Text tone="caption">
                    {t("workflow.artifactCreated" as never, {
                      createdAt: artifact.createdAt,
                    })}
                  </Text>
                </div>
              </details>
            ))}
          </div>
        ) : null}

        {invocation.status === "BLOCKED_INSUFFICIENT_USAGE" ? (
          <div className={styles.stepActions}>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => router.push("/settings/billing")}
            >
              {t("workflow.openBilling" as never)}
            </Button>
          </div>
        ) : null}

        {invocation.requiresApproval ? (
          <div className={styles.stepActions}>
            <Button
              size="sm"
              variant="primary"
              onClick={() => onApprove(invocation.id)}
              disabled={busyKey !== null}
              loading={busyKey === approveKey}
            >
              {t("workflow.approve")}
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function WorkflowStatusBadge({
  status,
}: {
  status: WorkflowPlanStatus;
}): ReactElement {
  const t = useTranslations();
  const variant =
    status === "COMPLETED"
      ? "success"
      : status === "FAILED"
        ? "danger"
        : status === "PARTIAL" || status === "CANCELED"
          ? "warning"
          : status === "RUNNING"
            ? "accent"
            : "neutral";
  return (
    <Badge variant={variant}>
      {t(`workflow.planStatus.${status}` as never)}
    </Badge>
  );
}

function InvocationStatusBadge({
  status,
}: {
  status: WorkflowInvocationStatus;
}): ReactElement {
  const t = useTranslations();
  const variant =
    status === "COMPLETED"
      ? "success"
      : status === "FAILED"
        ? "danger"
        : status === "WAITING_APPROVAL" ||
            status === "WAITING_FOR_USAGE_CAPACITY" ||
            status === "BLOCKED_INSUFFICIENT_USAGE"
          ? "warning"
          : status === "RUNNING"
            ? "accent"
            : "neutral";
  return (
    <Badge variant={variant}>
      {t(`workflow.invocationStatus.${status}` as never)}
    </Badge>
  );
}

function targetLabel(
  invocation: WorkflowInvocation,
  t: ReturnType<typeof useTranslations>,
): string {
  switch (invocation.target.kind) {
    case "VIMLA":
      return "Vimla";
    case "AI_AUTO":
      return t("workflow.targetAuto" as never);
    case "AI_MODEL":
      return invocation.target.modelSlug;
    case "EVALUATOR":
      return t("workflow.targetEvaluator" as never);
    case "AGENT":
      return t("workflow.targetAgent" as never);
  }
}

function invocationStatusDetail(
  invocation: WorkflowInvocation,
  t: ReturnType<typeof useTranslations>,
): string | null {
  if (invocation.status === "WAITING_FOR_USAGE_CAPACITY") {
    return t("workflow.waitingCapacity" as never);
  }
  if (invocation.status === "BLOCKED_INSUFFICIENT_USAGE") {
    return t("workflow.blockedUsage" as never);
  }
  if (invocation.status === "WAITING_APPROVAL") {
    return t("workflow.waitingApproval" as never);
  }
  if (invocation.status === "FAILED") {
    return workflowFailureLabel(invocation.latestRun?.errorCode ?? null, t);
  }
  return null;
}

function dependencyLabel(
  dependency: WorkflowDependency,
  sourcePurpose: string,
  t: ReturnType<typeof useTranslations>,
): string {
  switch (dependency.condition.kind) {
    case "DATA":
      return t("workflow.dependencyData" as never, { source: sourcePurpose });
    case "ON_SUCCESS":
      return t("workflow.dependencySuccess" as never, { source: sourcePurpose });
    case "ON_FAILURE":
      return t("workflow.dependencyFailure" as never, { source: sourcePurpose });
    case "ALWAYS":
      return t("workflow.dependencyAlways" as never, { source: sourcePurpose });
    case "OUTCOME":
      return t("workflow.dependencyOutcome" as never, {
        source: sourcePurpose,
        outcome: dependency.condition.outcome,
      });
  }
}

function workflowFailureLabel(
  errorCode: string | null,
  t: ReturnType<typeof useTranslations>,
): string {
  if (errorCode === "PLAN_SPEND_LIMIT_REACHED") {
    return t("workflow.failureSpendLimit" as never);
  }
  if (
    errorCode === "AI_RECONCILIATION_REQUIRED" ||
    errorCode === "AI_PROVIDER_BOUNDEDNESS_VIOLATION"
  ) {
    return t("workflow.failureReconciliation" as never);
  }
  if (errorCode === "AI_PROVIDER_INTERRUPTED") {
    return t("workflow.failureInterrupted" as never);
  }
  return t("workflow.failureGeneric" as never);
}
