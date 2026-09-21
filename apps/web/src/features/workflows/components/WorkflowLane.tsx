"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Text } from "@vimla/ui";
import type { ExecutionPlanView } from "@vimla/contracts";
import { AuthRequiredError } from "../../auth/services/current-user";
import {
  WorkflowRequestError,
  approveExecutionPlanInvocation,
  fetchConversationWorkflows,
  startExecutionPlan,
  stopExecutionPlan,
} from "../services/workflows";
import { WorkflowCard } from "./WorkflowCard";
import { TERMINAL_PLAN_STATUSES } from "./workflow-presentation";
import styles from "./WorkflowLane.module.scss";

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
  const requestVersion = useRef(0);
  const mutationInFlight = useRef(false);

  const handleLoadError = useCallback(
    (error: unknown): void => {
      if (error instanceof AuthRequiredError) {
        router.replace("/sign-in");
        return;
      }
      setFailed(true);
    },
    [router],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (mutationInFlight.current) return;
    const version = ++requestVersion.current;
    try {
      const response = await fetchConversationWorkflows(conversationId);
      if (version !== requestVersion.current) return;
      setPlans(response.plans);
      setFailed(false);
    } catch (error: unknown) {
      if (version !== requestVersion.current) return;
      handleLoadError(error);
    }
  }, [conversationId, handleLoadError]);

  useEffect(() => {
    let cancelled = false;
    const version = ++requestVersion.current;
    void fetchConversationWorkflows(conversationId)
      .then((response) => {
        if (cancelled || version !== requestVersion.current) return;
        setPlans(response.plans);
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (cancelled || version !== requestVersion.current) return;
        handleLoadError(error);
      });

    return () => {
      cancelled = true;
      if (version === requestVersion.current) {
        requestVersion.current += 1;
      }
    };
  }, [conversationId, handleLoadError]);

  const hasActivePlan = useMemo(
    () => plans.some((plan) => !TERMINAL_PLAN_STATUSES.has(plan.status)),
    [plans],
  );

  useEffect(() => {
    if (!hasActivePlan) return;

    const timer = window.setInterval(() => {
      if (
        document.visibilityState !== "visible" ||
        mutationInFlight.current
      ) {
        return;
      }
      void refresh();
    }, 3_000);

    return () => {
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
    if (mutationInFlight.current) return;

    mutationInFlight.current = true;
    requestVersion.current += 1;
    setBusyKey(key);
    let refreshAfterFailure = false;

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
      refreshAfterFailure = error instanceof WorkflowRequestError;
    } finally {
      mutationInFlight.current = false;
      setBusyKey(null);
      if (refreshAfterFailure) {
        void refresh();
      }
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
