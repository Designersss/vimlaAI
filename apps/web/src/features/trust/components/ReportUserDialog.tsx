"use client";

import { useState, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import {
  TRUST_LIMITS,
  type AbuseReportReason,
  type DirectMessageReportEvidence,
} from "@vimla/contracts";
import {
  Alert,
  Button,
  Dialog,
  FormField,
  NativeSelect,
  Text,
  Textarea,
} from "@vimla/ui";
import { reportUser } from "../services/api";
import styles from "./Trust.module.scss";

const REASONS: readonly AbuseReportReason[] = [
  "HARASSMENT",
  "HATE",
  "THREATS",
  "SPAM",
  "IMPERSONATION",
  "SEXUAL_CONTENT",
  "SELF_HARM",
  "OTHER",
];

export function ReportUserDialog({
  open,
  onOpenChange,
  targetHandle,
  evidence,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetHandle: string;
  evidence?: DirectMessageReportEvidence;
}): ReactElement {
  const t = useTranslations();
  const [reason, setReason] = useState<AbuseReportReason>("HARASSMENT");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<"idle" | "success" | "error">("idle");

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen) {
      setReason("HARASSMENT");
      setDetails("");
      setState("idle");
    }
    onOpenChange(nextOpen);
  }

  async function submit(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setState("idle");
    try {
      await reportUser({
        targetHandle,
        reason,
        ...(details.trim().length > 0 ? { details } : {}),
        ...(evidence ? { evidence } : {}),
      });
      setState("success");
    } catch {
      setState("error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t("trust.reportTitle", { handle: targetHandle })}
      description={t("trust.reportDescription")}
      closeLabel={t("common.close")}
      actions={
        <>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            {state === "success" ? t("common.close") : t("common.cancel")}
          </Button>
          {state !== "success" ? (
            <Button disabled={submitting} onClick={() => void submit()}>
              {t("trust.submitReport")}
            </Button>
          ) : null}
        </>
      }
    >
      <div className={styles.dialogBody}>
        {evidence ? (
          <Alert variant="info">
            {t("trust.evidenceDisclosure")}
          </Alert>
        ) : null}
        {state === "success" ? (
          <Alert variant="success">{t("trust.reportSubmitted")}</Alert>
        ) : (
          <>
            <FormField label={t("trust.reason")} htmlFor="trust-report-reason">
              <NativeSelect
                id="trust-report-reason"
                value={reason}
                onChange={(event) =>
                  setReason(event.currentTarget.value as AbuseReportReason)
                }
              >
                {REASONS.map((value) => (
                  <option key={value} value={value}>
                    {t(`trust.reason_${value}`)}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label={t("trust.details")} htmlFor="trust-report-details">
              <Textarea
                id="trust-report-details"
                rows={4}
                value={details}
                maxLength={TRUST_LIMITS.reportDetailsMax}
                onChange={(event) => setDetails(event.currentTarget.value)}
              />
            </FormField>
            {evidence ? (
              <div className={styles.evidencePreview}>
                <Text tone="caption">{t("trust.selectedEvidence")}</Text>
                <blockquote>{evidence.disclosedText}</blockquote>
              </div>
            ) : null}
          </>
        )}
        {state === "error" ? (
          <Alert variant="error">{t("common.genericError")}</Alert>
        ) : null}
      </div>
    </Dialog>
  );
}
