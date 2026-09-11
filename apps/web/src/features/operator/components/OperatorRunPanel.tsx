"use client";

import type { ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { OperatorActionCard, StreamingIndicator, Text } from "@vimla/ui";
import type { OperatorActionCard as OperatorAction, OperatorRunView } from "@vimla/contracts";

import styles from "./OperatorRunPanel.module.scss";

export function OperatorRunPanel({
  run,
  processing,
  onConfirm,
  onCancel,
}: {
  run: OperatorRunView;
  processing?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}): ReactElement {
  const t = useTranslations();
  const router = useRouter();

  return (
    <div className={styles.panel}>
      {run.status === "PLANNING" || run.status === "EXECUTING" || run.status === "CREATED" ? (
        <StreamingIndicator label={t("operator.processing")} />
      ) : null}
      {run.publicMessage ? <Text>{run.publicMessage}</Text> : null}
      {run.clarificationQuestion ? <Text tone="secondary">{run.clarificationQuestion}</Text> : null}
      {run.actions.map((action, index) => (
        <OperatorActionCard
          key={`${action.kind}-${action.title}-${index}`}
          title={action.title}
          detail={action.detail}
          statusLabel={
            action.status === "pending_confirmation"
              ? t("operator.needsConfirmation")
              : action.status === "error"
                ? t("operator.failed")
                : action.status === "skipped"
                  ? t("operator.skipped")
                  : t(`operator.ops.${action.operation}` as never)
          }
          tone={toneOf(action.status)}
          hrefLabel={action.hrefPath ? t("operator.open") : undefined}
          onOpen={action.hrefPath ? () => router.push(action.hrefPath ?? "/work") : undefined}
          confirmLabel={run.confirmationRequired && index === 0 ? t("operator.confirm") : undefined}
          cancelLabel={run.confirmationRequired && index === 0 ? t("common.cancel") : undefined}
          onConfirm={run.confirmationRequired && index === 0 ? onConfirm : undefined}
          onCancel={run.confirmationRequired && index === 0 ? onCancel : undefined}
          processing={processing}
        />
      ))}
    </div>
  );
}

function toneOf(status: OperatorAction["status"]): "neutral" | "success" | "warning" | "danger" {
  if (status === "success") {
    return "success";
  }
  if (status === "pending_confirmation") {
    return "warning";
  }
  if (status === "error") {
    return "danger";
  }
  return "neutral";
}
