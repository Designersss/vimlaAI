"use client";

import { useEffect, useState, type ReactElement } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { PaymentView } from "@vimla/contracts";
import { Alert, Card, Spinner, Text, buttonClassName } from "@vimla/ui";
import { AuthRequiredError } from "../../../features/auth/services/current-user";
import { fetchPayment } from "../../../features/billing/services/payments";

const MAX_POLLS = 8;

export function PaymentResult(): ReactElement {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const paymentId = searchParams.get("paymentId");
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!paymentId) {
      return;
    }
    let cancelled = false;
    let attempt = 0;

    async function load(): Promise<void> {
      try {
        const current = await fetchPayment(paymentId ?? "");
        if (cancelled) {
          return;
        }
        setPayment(current);
        if ((current.status === "CREATED" || current.status === "PENDING") && attempt < MAX_POLLS) {
          attempt += 1;
          window.setTimeout(() => {
            void load();
          }, 2000);
        }
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }
        if (error instanceof AuthRequiredError) {
          setLoadError(t("errors.unauthorized"));
          return;
        }
        setLoadError(t("billing.missingPayment"));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [paymentId, t]);

  const error = paymentId ? loadError : t("billing.missingPayment");

  return (
    <Card>
      {error ? <Alert variant="error">{error}</Alert> : null}
      {payment ? (
        <Text>
          {t(`billing.status.${payment.status}` as never)} · {payment.kind}
        </Text>
      ) : null}
      {!error && !payment ? <Spinner label={t("billing.waiting")} /> : null}
      <p>
        <Link href="/settings/billing" className={buttonClassName({ variant: "secondary", size: "sm" })}>
          {t("billing.title")}
        </Link>
      </p>
    </Card>
  );
}
