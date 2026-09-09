"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { PaymentView, RetailPlan, SubscriptionResponse, UsageResponse } from "@vimla/contracts";
import { AuthRequiredError } from "../../../auth/services/current-user";
import { fetchUsage } from "../../services/usage";
import {
  checkoutSubscription,
  checkoutTopup,
  fetchPayments,
  fetchPlans,
  fetchSubscription,
} from "../../services/payments";
import { apiErrorMessageKey } from "../../../../shared/errors/error-keys";
import { tx } from "../../../../shared/i18n/translate";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormField,
  Heading,
  NativeSelect,
  Skeleton,
  StatusBadge,
  Text,
  UsageMeter,
} from "@vimla/ui";
import styles from "./BillingSettings.module.scss";

const TOPUP_PRESETS_RUB = ["100", "500", "1000", "3000"] as const;

export function BillingSettings(): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const submittingRef = useRef(false);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionResponse["subscription"]>(null);
  const [plans, setPlans] = useState<RetailPlan[]>([]);
  const [payments, setPayments] = useState<PaymentView[]>([]);
  const [topupRub, setTopupRub] = useState("1000");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed" | "submitting">("loading");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchUsage(), fetchSubscription(), fetchPlans(), fetchPayments()])
      .then(([currentUsage, currentSubscription, currentPlans, history]) => {
        if (cancelled) {
          return;
        }
        setUsage(currentUsage);
        setSubscription(currentSubscription.subscription);
        setPlans(currentPlans.plans);
        setPayments(history.payments);
        setState("ready");
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }
        if (loadError instanceof AuthRequiredError) {
          router.replace("/sign-in");
          return;
        }
        setState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function buyPlan(planCode: RetailPlan["code"]): Promise<void> {
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setState("submitting");
    setError(null);
    try {
      const checkout = await checkoutSubscription(planCode, crypto.randomUUID());
      window.location.assign(checkout.paymentUrl);
    } catch (buyError: unknown) {
      submittingRef.current = false;
      setState("ready");
      setError(tx(t, apiErrorMessageKey(errorCode(buyError))));
    }
  }

  async function onTopup(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setState("submitting");
    setError(null);
    try {
      const amountMicroRub = `${BigInt(topupRub) * 1_000_000n}`;
      const checkout = await checkoutTopup(amountMicroRub, crypto.randomUUID());
      window.location.assign(checkout.paymentUrl);
    } catch (buyError: unknown) {
      submittingRef.current = false;
      setState("ready");
      setError(tx(t, apiErrorMessageKey(errorCode(buyError))));
    }
  }

  if (state === "loading") {
    return <Skeleton />;
  }
  if (state === "failed" || !usage) {
    return <ErrorState title={t("common.genericError")} />;
  }

  return (
    <section className={styles.stack}>
      <Card>
        <Heading as="h2" size="section">
          {t("billing.currentPlan")}
        </Heading>
        {subscription ? (
          <>
            <Text>
              {subscription.planName} ({subscription.planCode})
            </Text>
            <Text tone="secondary">{t("billing.activeUntil", { date: formatDate(subscription.periodEnd) })}</Text>
          </>
        ) : (
          <Text>{t("billing.noPlan")}</Text>
        )}
        <UsageMeter label={t("chat.monthlyUsage")} percent={usage.monthly.usedPercent} />
        <Text tone="caption">{t("chat.topupUsed", { percent: usage.topup.usedPercent })}</Text>
      </Card>

      <Card>
        <Heading as="h2" size="section">
          {t("billing.plans")}
        </Heading>
        <ul className={styles.plans}>
          {plans.map((plan) => (
            <li key={plan.code} className={styles.plan}>
              <div>
                <strong>{plan.name}</strong>
                <Text tone="secondary">{formatRub(plan.priceMicroRub)}</Text>
              </div>
              <Button
                type="button"
                disabled={state === "submitting" || Boolean(subscription)}
                onClick={() => {
                  void buyPlan(plan.code);
                }}
              >
                {t("billing.buy")}
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <form className={styles.stack} onSubmit={(event) => void onTopup(event)}>
          <Heading as="h2" size="section">
            {t("billing.topup")}
          </Heading>
          <Text tone="secondary">{t("billing.topupNeverExpires")}</Text>
          <FormField label={t("billing.topupAmount")} htmlFor="topup-amount">
            <NativeSelect
              id="topup-amount"
              value={topupRub}
              onChange={(event) => setTopupRub(event.target.value)}
            >
              {TOPUP_PRESETS_RUB.map((amount) => (
                <option key={amount} value={amount}>
                  {amount} RUB
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <Button type="submit" disabled={state === "submitting"} loading={state === "submitting"}>
            {t("billing.pay")}
          </Button>
        </form>
      </Card>

      {error ? <Alert variant="error">{error}</Alert> : null}

      <Card>
        <Heading as="h2" size="section">
          {t("billing.history")}
        </Heading>
        {payments.length === 0 ? <EmptyState title={t("billing.emptyHistory")} /> : null}
        <ul className={styles.history}>
          {payments.map((payment) => (
            <li key={payment.paymentId}>
              <Link href={`/payment/result?paymentId=${encodeURIComponent(payment.paymentId)}`}>
                <StatusBadge
                  tone={
                    payment.status === "SUCCEEDED"
                      ? "success"
                      : payment.status === "FAILED"
                        ? "danger"
                        : payment.status === "RECONCILIATION_REQUIRED"
                          ? "warning"
                          : "neutral"
                  }
                >
                  {t(`billing.status.${payment.status}` as never)}
                </StatusBadge>
                {" · "}
                {formatRub(payment.amountMicroRub)}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function formatRub(amountMicroRub: string): string {
  return `${(BigInt(amountMicroRub) / 1_000_000n).toString(10)} RUB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function errorCode(error: unknown): string | undefined {
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return undefined;
}
