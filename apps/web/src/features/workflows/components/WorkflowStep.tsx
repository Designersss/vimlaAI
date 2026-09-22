"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, Text } from "@vimla/ui";
import type {
  WorkflowDependency,
  WorkflowInvocation,
} from "@vimla/contracts";
import { tx } from "../../../shared/i18n/translate";
import {
  dependencyLabel,
  invocationStatusDetail,
  invocationStatusLabel,
  invocationStatusVariant,
  latestRunSummary,
  targetLabel,
} from "./workflow-presentation";
import styles from "./WorkflowLane.module.scss";

export function WorkflowStep({
  index,
  planId,
  invocation,
  incomingDependencies,
  sourceInvocations,
  busyKey,
  onApprove,
  onEvaluate,
}: {
  index: number;
  planId: string;
  invocation: WorkflowInvocation;
  incomingDependencies: WorkflowDependency[];
  sourceInvocations: WorkflowInvocation[];
  busyKey: string | null;
  onApprove: (invocationId: string) => void;
  onEvaluate: (invocationId: string, outcome: "PASS" | "FAIL") => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const approveKey = `approve:${planId}:${invocation.id}`;
  const passKey = `evaluate:${planId}:${invocation.id}:PASS`;
  const failKey = `evaluate:${planId}:${invocation.id}:FAIL`;
  const isHumanEvaluator =
    invocation.target.kind === "EVALUATOR" &&
    invocation.approvalPolicy === "HUMAN_APPROVAL";
  const detail = invocationStatusDetail(invocation, t);
  const runSummary = latestRunSummary(invocation, t);

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
            <Badge variant={invocationStatusVariant(invocation.status)}>
              {invocationStatusLabel(t, invocation.status)}
            </Badge>
          </div>
        </div>

        {detail ? <Text tone="caption">{detail}</Text> : null}
        {runSummary ? <Text tone="caption">{runSummary}</Text> : null}

        {incomingDependencies.length > 0 ? (
          <div className={styles.dependencies}>
            {incomingDependencies.map((dependency) => {
              const source = sourceInvocations.find(
                (candidate) => candidate.id === dependency.fromInvocationId,
              );
              return (
                <Text tone="caption" key={dependency.id}>
                  {dependencyLabel(
                    dependency,
                    source?.purpose ?? dependency.fromInvocationId,
                    t,
                  )}
                </Text>
              );
            })}
          </div>
        ) : null}

        {invocation.target.kind === "EVALUATOR" &&
        invocation.acceptanceCriteria.length > 0 ? (
          <div className={styles.dependencies}>
            <Text tone="caption">
              {t("workflow.evaluationCriteria")}
            </Text>
            {invocation.acceptanceCriteria.map((criterion) => (
              <Text tone="caption" key={criterion.id}>
                • {criterion.description}
              </Text>
            ))}
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
                    {tx(t, "workflow.artifactVersion", {
                      version: artifact.version,
                    })}
                  </Text>
                  <Text tone="caption">
                    {tx(t, "workflow.artifactClassification", {
                      classification: artifact.classification,
                    })}
                  </Text>
                  <Text tone="caption">
                    {tx(t, "workflow.artifactCreated", {
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
              {tx(t, "workflow.openBilling")}
            </Button>
          </div>
        ) : null}

        {invocation.requiresApproval && isHumanEvaluator ? (
          <div className={styles.stepActions}>
            <Button
              size="sm"
              variant="primary"
              onClick={() => onEvaluate(invocation.id, "PASS")}
              disabled={busyKey !== null}
              loading={busyKey === passKey}
            >
              {t("workflow.evaluationPass")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onEvaluate(invocation.id, "FAIL")}
              disabled={busyKey !== null}
              loading={busyKey === failKey}
            >
              {t("workflow.evaluationFail")}
            </Button>
          </div>
        ) : invocation.requiresApproval ? (
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

        {invocation.latestRun?.evaluation ? (
          <Text tone="caption">
            {t("workflow.evaluationResult", {
              outcome: invocation.latestRun.evaluation.outcome,
              confidence: Math.round(
                invocation.latestRun.evaluation.confidence * 100,
              ),
            })}
          </Text>
        ) : null}
      </div>
    </li>
  );
}
