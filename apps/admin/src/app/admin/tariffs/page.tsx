"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { adminFetch } from "../../../shared/api/admin-fetch";
import styles from "../admin.module.scss";

interface PlanRow {
  id: string;
  code: string;
  name: string;
  versions: Array<{
    id: string;
    status: string;
    priceMicroRub: string;
    monthlyUsageGrantMicroRub: string;
    entitlements: Array<{ key: string }>;
  }>;
}

const CANONICAL_DRAFT_ENTITLEMENTS = [
  { key: "projects.ownedActiveMax", value: { kind: "COUNT", unlimited: false, value: "3" } },
  { key: "projects.externalActiveMax", value: { kind: "COUNT", unlimited: false, value: "4" } },
  {
    key: "projects.membersPerOwnedProjectMax",
    value: { kind: "COUNT", unlimited: false, value: "4" },
  },
  { key: "billing.topupAllowed", value: { kind: "BOOLEAN", value: true } },
];

export default function TariffsPage() {
  const t = useTranslations();
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function reload(): Promise<void> {
    const response = await adminFetch("/admin/v1/tariffs/plans");
    if (response.ok) {
      setPlans((await response.json()) as PlanRow[]);
    }
  }

  useEffect(() => {
    void (async () => {
      const response = await adminFetch("/admin/v1/tariffs/plans");
      if (response.ok) {
        setPlans((await response.json()) as PlanRow[]);
      }
    })();
  }, []);

  async function createDraft(plan: PlanRow) {
    const latest = plan.versions[0];
    const response = await adminFetch("/admin/v1/tariffs/plans/drafts", {
      method: "POST",
      body: JSON.stringify({
        planId: plan.id,
        priceMicroRub: latest?.priceMicroRub ?? "0",
        monthlyUsageGrantMicroRub: latest?.monthlyUsageGrantMicroRub ?? "0",
        subscriptionPeriodDays: 30,
        entitlements: CANONICAL_DRAFT_ENTITLEMENTS,
      }),
    });
    if (!response.ok) {
      setMessage(t("app.denied"));
      return;
    }
    const created = (await response.json()) as { id: string };
    setMessage(created.id);
    await reload();
  }

  async function simulate(id: string) {
    const response = await adminFetch(`/admin/v1/tariffs/plans/${id}/simulate`, { method: "POST" });
    const body = (await response.json()) as {
      worstCase?: { conservativeMarginBps: number | null; guardrail: string };
    };
    if (!response.ok) {
      setMessage(t("app.denied"));
      return;
    }
    const worst = body.worstCase;
    if (!worst) {
      setMessage(t("finance.unverifiedFees"));
      return;
    }
    if (worst.guardrail === "NEGATIVE") {
      setMessage(t("tariffs.negativeSevere"));
    } else if (worst.guardrail === "WARNING") {
      setMessage(t("tariffs.negativeWarning"));
    } else {
      setMessage(`${worst.conservativeMarginBps ?? "n/a"} bps`);
    }
  }

  async function publish(planCode: string, id: string) {
    const response = await adminFetch(`/admin/v1/tariffs/plans/${id}/publish`, {
      method: "POST",
      body: JSON.stringify({
        acknowledgeNegativeOrLowMargin: true,
        reason: "admin ui publish",
        typedPlanCode: planCode,
      }),
    });
    setMessage(response.ok ? id : t("app.denied"));
    if (response.ok) {
      await reload();
    }
  }

  return (
    <section>
      <h1>{t("tariffs.title")}</h1>
      <p>{t("tariffs.legacy")}</p>
      {message ? <p role="status">{message}</p> : null}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Plan</th>
            <th>Version</th>
            <th>Status</th>
            <th>Price</th>
            <th>Grant</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {plans.flatMap((plan) =>
            plan.versions.map((version, index) => (
              <tr key={version.id}>
                <td>{plan.code}</td>
                <td>{version.id.slice(0, 8)}</td>
                <td>{version.status}</td>
                <td>{version.priceMicroRub}</td>
                <td>{version.monthlyUsageGrantMicroRub}</td>
                <td>
                  {index === 0 ? (
                    <button
                      type="button"
                      className={styles.button}
                      data-testid={`create-draft-${plan.code}`}
                      onClick={() => void createDraft(plan)}
                    >
                      {t("app.createDraft")}
                    </button>
                  ) : null}
                  <button type="button" className={styles.button} onClick={() => void simulate(version.id)}>
                    {t("app.simulate")}
                  </button>
                  {version.status === "DRAFT" ? (
                    <button
                      type="button"
                      className={styles.button}
                      data-testid={`publish-${version.id}`}
                      onClick={() => void publish(plan.code, version.id)}
                    >
                      {t("app.publish")}
                    </button>
                  ) : null}
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </section>
  );
}
