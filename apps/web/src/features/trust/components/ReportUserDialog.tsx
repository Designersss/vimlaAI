"use client";

import { useEffect, useState, type ReactElement } from "react";
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
  const [evidenceText, setEvidenceText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<"idle" | "success" | "error">("idle");

  useEffect(() => {
    if (!open) return;
    setEvidenceText(
      evidence
        ? boundedEvidenceExcerpt(evidence.disclosedText)
        : "",
    );
  }, [evidence?.messageId, evidence?.disclosedText, open]);

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
        ...(evidence
          ? {
              evidence: {
                ...evidence,
                disclosedText: evidenceText,
              },
            }
          : {}),
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
            {state === "success" ? t("trust.reportDone") : t("common.cancel")}
          </Button>
          {state !== "success" ? (
            <Button
              disabled={
                submitting ||
                (evidence !== undefined &&
                  evidenceText.trim().length === 0)
              }
              onClick={() => void submit()}
            >
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
                {evidence.disclosedText.length >
                TRUST_LIMITS.evidenceTextMax ? (
                  <Alert variant="info">
                    {t("trust.evidenceExcerptLong", {
                      max: TRUST_LIMITS.evidenceTextMax,
                    })}
                  </Alert>
                ) : null}
                <FormField
                  label={t("trust.evidenceExcerpt")}
                  htmlFor="trust-report-evidence"
                >
                  <Textarea
                    id="trust-report-evidence"
                    rows={6}
                    value={evidenceText}
                    maxLength={TRUST_LIMITS.evidenceTextMax}
                    onChange={(event) =>
                      setEvidenceText(event.currentTarget.value)
                    }
                  />
                </FormField>
                <Text tone="caption">
                  {t("trust.evidenceExcerptHelp", {
                    max: TRUST_LIMITS.evidenceTextMax,
                  })}
                </Text>
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


function boundedEvidenceExcerpt(value: string): string {
  return value.slice(0, TRUST_LIMITS.evidenceTextMax);
}
