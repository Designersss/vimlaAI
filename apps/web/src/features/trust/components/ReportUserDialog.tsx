"use client";

import { useRef, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
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
import {
  AuthRequiredError,
  reportUser,
} from "../services/api";
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
  const router = useRouter();
  const [reason, setReason] = useState<AbuseReportReason>("HARASSMENT");
  const [details, setDetails] = useState("");
  const [evidenceEdits, setEvidenceEdits] = useState<Record<string, string>>({});
  const evidenceText = evidence
    ? (evidenceEdits[evidence.messageId] ??
      boundedEvidenceExcerpt(evidence.disclosedText))
    : "";
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<"idle" | "success" | "error">("idle");
  const submissionGenerationRef = useRef(0);
  const requestIdRef = useRef<string | null>(null);

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen && submitting) return;
    if (!nextOpen) {
      submissionGenerationRef.current += 1;
      setReason("HARASSMENT");
      setDetails("");
      setEvidenceEdits({});
      setSubmitting(false);
      setState("idle");
      requestIdRef.current = null;
    }
    onOpenChange(nextOpen);
  }

  async function submit(): Promise<void> {
    if (submitting) return;
    const generation = submissionGenerationRef.current + 1;
    submissionGenerationRef.current = generation;
    const requestId =
      requestIdRef.current ?? crypto.randomUUID();
    requestIdRef.current = requestId;
    setSubmitting(true);
    setState("idle");
    try {
      await reportUser({
        requestId,
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
      if (submissionGenerationRef.current === generation) {
        setState("success");
      }
    } catch (error: unknown) {
      if (error instanceof AuthRequiredError) {
        router.replace("/sign-in");
        return;
      }
      if (submissionGenerationRef.current === generation) {
        setState("error");
      }
    } finally {
      if (submissionGenerationRef.current === generation) {
        setSubmitting(false);
      }
    }
  }

  function resetRetryIdentity(): void {
    requestIdRef.current = null;
    if (state === "error") {
      setState("idle");
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
          <Button
            variant="ghost"
            disabled={submitting}
            onClick={() => handleOpenChange(false)}
          >
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
                disabled={submitting}
                onChange={(event) => {
                  resetRetryIdentity();
                  setReason(event.currentTarget.value as AbuseReportReason);
                }}
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
                disabled={submitting}
                maxLength={TRUST_LIMITS.reportDetailsMax}
                onChange={(event) => {
                  resetRetryIdentity();
                  setDetails(event.currentTarget.value);
                }}
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
                    disabled={submitting}
                    maxLength={TRUST_LIMITS.evidenceTextMax}
                    onChange={(event) => {
                      const messageId = evidence.messageId;
                      const nextValue = event.currentTarget.value;
                      resetRetryIdentity();
                      setEvidenceEdits((current) => ({
                        ...current,
                        [messageId]: nextValue,
                      }));
                    }}
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
  let end = Math.min(
    value.length,
    TRUST_LIMITS.evidenceTextMax,
  );
  if (
    end > 0 &&
    end < value.length &&
    isHighSurrogate(value.charCodeAt(end - 1)) &&
    isLowSurrogate(value.charCodeAt(end))
  ) {
    end -= 1;
  }
  return value.slice(0, end);
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}
