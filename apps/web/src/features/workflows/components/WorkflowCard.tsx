"use client";

import { useTranslations } from "next-intl";
import { Badge, Button, Card, Progress, Text } from "@vimla/ui";
import type { ExecutionPlanView } from "@vimla/contracts";
import {
  TERMINAL_INVOCATION_STATUSES,
  planStatusLabel,
  planStatusVariant,
} from "./workflow-presentation";
import { WorkflowStep } from "./WorkflowStep";
import styles from "./WorkflowLane.module.scss";

export function WorkflowCard({
  plan,
  busyKey,
  onStart,
  onStop,
  onApprove,
  onEvaluate,
}: {
  plan: ExecutionPlanView;
  busyKey: string | null;
  onStart: () => void;
  onStop: () => void;
  onApprove: (invocationId: string) => void;
  onEvaluate: (invocationId: string, outcome: "PASS" | "FAIL") => void;
}) {
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
            <Badge variant={planStatusVariant(plan.status)}>
              {planStatusLabel(t, plan.status)}
            </Badge>
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
          {plan.status === "PLANNING" ||
          plan.status === "PLANNED" ||
          plan.status === "RUNNING" ? (
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
            onEvaluate={onEvaluate}
          />
        ))}
      </ol>
    </Card>
  );
}
