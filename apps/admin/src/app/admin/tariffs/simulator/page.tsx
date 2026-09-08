"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { adminFetch } from "../../../../shared/api/admin-fetch";
import { formatBps, formatMoney } from "../../../../shared/ui/format";
import styles from "../../admin.module.scss";

interface PlanRow {
  id: string;
  code: string;
  versions: Array<{ id: string; status: string; priceMicroRub: string; monthlyUsageGrantMicroRub: string }>;
}

interface Simulation {
  methods: Array<{
    paymentMethod: string;
    paymentCostMicroRub: string;
    fiscalizationCostMicroRub: string;
    taxReserveMicroRub: string | null;
    maxAiCommitmentMicroRub: string;
    conservativeContributionMicroRub: string;
    conservativeMarginBps: number | null;
    guardrail: string;
  }>;
  worstCase: {
    paymentMethod: string;
    conservativeMarginBps: number | null;
    guardrail: string;
  } | null;
}

export default function SimulatorPage() {
  const t = useTranslations();
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const response = await adminFetch("/admin/v1/tariffs/plans");
      if (response.ok) {
        setPlans((await response.json()) as PlanRow[]);
      }
    })();
  }, []);

  async function simulate(id: string): Promise<void> {
    const response = await adminFetch(`/admin/v1/tariffs/plans/${id}/simulate`, { method: "POST" });
    if (!response.ok) {
      setMessage(t("app.denied"));
      return;
    }
    const body = (await response.json()) as Simulation;
    setSimulation(body);
    if (!body.worstCase) {
      setMessage(t("finance.unverifiedFees"));
    } else if (body.worstCase.guardrail === "NEGATIVE") {
      setMessage(t("tariffs.negativeSevere"));
    } else if (body.worstCase.guardrail === "WARNING") {
      setMessage(t("tariffs.negativeWarning"));
    } else {
      setMessage(null);
    }
  }

  return (
    <section>
      <h1>{t("nav.simulator")}</h1>
      {message ? <p role="status">{message}</p> : null}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Plan</th>
            <th>status</th>
            <th>{t("finance.grossRevenue")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {plans.flatMap((plan) =>
            plan.versions.map((version) => (
              <tr key={version.id}>
                <td>{plan.code}</td>
                <td>{version.status}</td>
                <td>{formatMoney(version.priceMicroRub)}</td>
                <td>
                  <button type="button" className={styles.button} onClick={() => void simulate(version.id)}>
                    {t("app.simulate")}
                  </button>
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
      {simulation ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t("finance.method")}</th>
              <th>{t("finance.paymentCosts")}</th>
              <th>{t("finance.fiscalizationCosts")}</th>
              <th>{t("finance.taxReserve")}</th>
              <th>{t("finance.aiCogs")}</th>
              <th>{t("finance.conservativeContribution")}</th>
              <th>{t("finance.conservativeMargin")}</th>
            </tr>
          </thead>
          <tbody>
            {simulation.methods.map((row) => (
              <tr key={row.paymentMethod}>
                <td>{row.paymentMethod}</td>
                <td>{formatMoney(row.paymentCostMicroRub)}</td>
                <td>{formatMoney(row.fiscalizationCostMicroRub)}</td>
                <td>{formatMoney(row.taxReserveMicroRub)}</td>
                <td>{formatMoney(row.maxAiCommitmentMicroRub)}</td>
                <td>{formatMoney(row.conservativeContributionMicroRub)}</td>
                <td className={row.guardrail === "NEGATIVE" ? styles.danger : row.guardrail === "WARNING" ? styles.warn : undefined}>
                  {formatBps(row.conservativeMarginBps)} ({row.guardrail})
                </td>
              </tr>
            ))}
            {simulation.worstCase ? (
              <tr>
                <th>WORST_CASE</th>
                <td colSpan={6}>
                  {simulation.worstCase.paymentMethod} {formatBps(simulation.worstCase.conservativeMarginBps)}{" "}
                  {simulation.worstCase.guardrail}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
