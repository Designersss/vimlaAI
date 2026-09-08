"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "../../shared/api/admin-fetch";
import { formatBps, formatMoney, presetRange } from "../../shared/ui/format";
import styles from "./admin.module.scss";

interface OverviewResponse {
  timezone: string;
  overview: {
    grossRevenueMicroRub: string;
    refundsMicroRub: string;
    chargebackAmountMicroRub: string;
    netSalesMicroRub: string;
    usedPaymentFeesMicroRub: string;
    usedFiscalizationFeesMicroRub: string;
    realizedAiCogsMicroRub: string;
    outstandingMonthlyUsageMicroRub: string;
    outstandingTopupUsageMicroRub: string;
    expiredMonthlyUsageMicroRub: string;
    realizedContributionMicroRub: string;
    conservativeContributionMicroRub: string;
    realizedMarginBps: number | null;
    conservativeMarginBps: number | null;
    paymentFeeQuality: string;
    fiscalizationFeeQuality: string;
    estimatedTaxReserveMicroRub: string | null;
  };
  usage: {
    topupNeverExpires: boolean;
    monthlyGrantedMicroRub: string;
    monthlyConsumedMicroRub: string;
    monthlyExpiredUnusedMicroRub: string;
    topupGrantedMicroRub: string;
    topupConsumedMicroRub: string;
    topupOutstandingMicroRub: string;
  };
  paymentMethods?: Array<{
    paymentMethod: string;
    paymentCount: number;
    grossRevenueMicroRub: string;
    usedFeesMicroRub: string;
    feeQuality: string;
    effectiveFeeBps: number | null;
  }>;
  models?: Array<{
    slug: string;
    requestCount: number;
    inputTokens: string;
    outputTokens: string;
    providerActualCostMicroRub: string;
    userSettledUsageMicroRub: string;
    differenceMicroRub: string;
    averageCostPerRequestMicroRub: string | null;
  }>;
  series?: Array<{
    date: string;
    grossRevenueMicroRub: string;
    realizedAiCogsMicroRub: string;
    realizedContributionMicroRub: string;
  }>;
}

function qualityLabel(
  quality: string,
  labels: { actual: string; estimated: string; partial: string; unknown: string },
): string {
  if (quality === "ACTUAL") return labels.actual;
  if (quality === "ESTIMATED") return labels.estimated;
  if (quality === "PARTIAL") return labels.partial;
  return labels.unknown;
}

export default function AdminHomePage() {
  const t = useTranslations();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<"today" | "7" | "30" | "custom">("30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const load = useCallback(
    async (range: { from: string; to: string }, reportingTimezone = "Europe/Moscow") => {
      const params = new URLSearchParams({
        from: range.from,
        to: range.to,
        timezone: reportingTimezone,
      });
      const response = await adminFetch(`/admin/v1/finance/overview?${params.toString()}`);
      if (!response.ok) {
        setError(t("app.denied"));
        return;
      }
      setError(null);
      setData((await response.json()) as OverviewResponse);
    },
    [t],
  );

  useEffect(() => {
    void (async () => {
      const range = presetRange("Europe/Moscow", "30");
      const params = new URLSearchParams({
        from: range.from,
        to: range.to,
        timezone: "Europe/Moscow",
      });
      const response = await adminFetch(`/admin/v1/finance/overview?${params.toString()}`);
      if (!response.ok) {
        setError(t("app.denied"));
        return;
      }
      setError(null);
      setData((await response.json()) as OverviewResponse);
    })();
  }, [t]);

  function applyPreset(next: "today" | "7" | "30"): void {
    setPreset(next);
    const timezone = data?.timezone ?? "Europe/Moscow";
    void load(presetRange(timezone, next), timezone);
  }

  function applyCustom(): void {
    if (!customFrom || !customTo) {
      return;
    }
    setPreset("custom");
    const timezone = data?.timezone ?? "Europe/Moscow";
    void load(
      {
        from: new Date(`${customFrom}T00:00:00`).toISOString(),
        to: new Date(`${customTo}T23:59:59`).toISOString(),
      },
      timezone,
    );
  }

  if (error) {
    return <p role="alert">{error}</p>;
  }
  if (!data) {
    return <p>{t("app.loading")}</p>;
  }

  const qualityLabels = {
    actual: t("finance.qualityActual"),
    estimated: t("finance.qualityEstimated"),
    partial: t("finance.qualityPartial"),
    unknown: t("finance.qualityUnknown"),
  };
  const cards = [
    [t("finance.grossRevenue"), data.overview.grossRevenueMicroRub, data.overview.paymentFeeQuality],
    [t("finance.refunds"), data.overview.refundsMicroRub, "ACTUAL"],
    [t("finance.chargebacks"), data.overview.chargebackAmountMicroRub, "ACTUAL"],
    [t("finance.netSales"), data.overview.netSalesMicroRub, "ACTUAL"],
    [t("finance.paymentCosts"), data.overview.usedPaymentFeesMicroRub, data.overview.paymentFeeQuality],
    [t("finance.fiscalizationCosts"), data.overview.usedFiscalizationFeesMicroRub, data.overview.fiscalizationFeeQuality],
    [t("finance.aiCogs"), data.overview.realizedAiCogsMicroRub, "ACTUAL"],
    [t("finance.outstandingMonthly"), data.overview.outstandingMonthlyUsageMicroRub, "ACTUAL"],
    [t("finance.outstandingTopup"), data.overview.outstandingTopupUsageMicroRub, "ACTUAL"],
    [t("finance.expiredMonthly"), data.overview.expiredMonthlyUsageMicroRub, "ACTUAL"],
    [t("finance.realizedContribution"), data.overview.realizedContributionMicroRub, "ACTUAL"],
    [t("finance.conservativeContribution"), data.overview.conservativeContributionMicroRub, "ESTIMATED"],
  ] as const;

  return (
    <section>
      <div className={styles.header}>
        <h1>{t("finance.title")}</h1>
        <span className={styles.badge}>{data.timezone}</span>
      </div>
      <div className={styles.filters}>
        <button type="button" className={styles.button} onClick={() => applyPreset("today")}>
          {t("finance.rangeToday")}
        </button>
        <button type="button" className={styles.button} onClick={() => applyPreset("7")}>
          {t("finance.range7")}
        </button>
        <button type="button" className={styles.button} onClick={() => applyPreset("30")}>
          {t("finance.range30")}
        </button>
        <label>
          {t("finance.rangeFrom")}
          <input className={styles.input} type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
        </label>
        <label>
          {t("finance.rangeTo")}
          <input className={styles.input} type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
        </label>
        <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={applyCustom}>
          {t("finance.rangeCustom")}
        </button>
        <span className={styles.badge}>{preset}</span>
      </div>
      <p className={styles.callout} data-testid="outstanding-topup">
        {t("finance.topupNeverExpires")}
      </p>
      <p>{t("finance.notNetProfit")}</p>
      <div className={styles.grid}>
        {cards.map(([label, value, quality]) => (
          <article key={label} className={styles.card}>
            <div>{label}</div>
            <p className={styles.kpi}>{formatMoney(value)}</p>
            <span className={`${styles.badge} ${quality === "ESTIMATED" || quality === "PARTIAL" ? styles.warn : quality === "UNKNOWN" ? styles.danger : styles.ok}`}>
              {qualityLabel(quality, qualityLabels)}
            </span>
          </article>
        ))}
        <article className={styles.card}>
          <div>{t("finance.taxReserve")}</div>
          <p className={styles.kpi}>{formatMoney(data.overview.estimatedTaxReserveMicroRub)}</p>
          <span className={`${styles.badge} ${styles.warn}`}>{t("finance.taxReserveEstimate")}</span>
        </article>
        <article className={styles.card}>
          <div>{t("finance.realizedMargin")}</div>
          <p className={styles.kpi}>{formatBps(data.overview.realizedMarginBps)}</p>
        </article>
        <article className={styles.card}>
          <div>{t("finance.conservativeMargin")}</div>
          <p className={styles.kpi}>{formatBps(data.overview.conservativeMarginBps)}</p>
          <span className={`${styles.badge} ${styles.warn}`}>{t("finance.qualityEstimated")}</span>
        </article>
      </div>
      <section>
        <h2>{t("finance.usageObligations")}</h2>
        <table className={styles.table}>
          <tbody>
            <tr>
              <th>{t("finance.monthlyGranted")}</th>
              <td>{formatMoney(data.usage.monthlyGrantedMicroRub)}</td>
            </tr>
            <tr>
              <th>{t("finance.monthlyConsumed")}</th>
              <td>{formatMoney(data.usage.monthlyConsumedMicroRub)}</td>
            </tr>
            <tr>
              <th>{t("finance.monthlyExpired")}</th>
              <td>{formatMoney(data.usage.monthlyExpiredUnusedMicroRub)}</td>
            </tr>
            <tr>
              <th>{t("finance.topupGranted")}</th>
              <td>{formatMoney(data.usage.topupGrantedMicroRub)}</td>
            </tr>
            <tr>
              <th>{t("finance.topupConsumed")}</th>
              <td>{formatMoney(data.usage.topupConsumedMicroRub)}</td>
            </tr>
            <tr>
              <th>{t("finance.outstandingTopup")}</th>
              <td>{formatMoney(data.usage.topupOutstandingMicroRub)}</td>
            </tr>
          </tbody>
        </table>
      </section>
      {data.paymentMethods && data.paymentMethods.length > 0 ? (
        <section>
          <h2>{t("finance.paymentMethods")}</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("finance.method")}</th>
                <th>{t("finance.count")}</th>
                <th>{t("finance.grossRevenue")}</th>
                <th>{t("finance.paymentCosts")}</th>
                <th>{t("finance.feePercent")}</th>
                <th>{t("finance.quality")}</th>
              </tr>
            </thead>
            <tbody>
              {data.paymentMethods.map((row) => (
                <tr key={row.paymentMethod}>
                  <td className={row.paymentMethod === "UNKNOWN" ? styles.danger : undefined}>{row.paymentMethod}</td>
                  <td>{row.paymentCount}</td>
                  <td>{formatMoney(row.grossRevenueMicroRub)}</td>
                  <td>{formatMoney(row.usedFeesMicroRub)}</td>
                  <td>{formatBps(row.effectiveFeeBps)}</td>
                  <td>{qualityLabel(row.feeQuality, qualityLabels)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {data.models && data.models.length > 0 ? (
        <section>
          <h2>{t("finance.modelEconomics")}</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("finance.model")}</th>
                <th>{t("finance.requests")}</th>
                <th>{t("finance.inputTokens")}</th>
                <th>{t("finance.outputTokens")}</th>
                <th>{t("finance.providerCogs")}</th>
                <th>{t("finance.userUsage")}</th>
                <th>{t("finance.difference")}</th>
                <th>{t("finance.avgCost")}</th>
              </tr>
            </thead>
            <tbody>
              {data.models.map((row) => (
                <tr key={row.slug}>
                  <td>{row.slug}</td>
                  <td>{row.requestCount}</td>
                  <td>{row.inputTokens}</td>
                  <td>{row.outputTokens}</td>
                  <td>{formatMoney(row.providerActualCostMicroRub)}</td>
                  <td>{formatMoney(row.userSettledUsageMicroRub)}</td>
                  <td>{formatMoney(row.differenceMicroRub)}</td>
                  <td>{formatMoney(row.averageCostPerRequestMicroRub)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {data.series && data.series.length > 0 ? (
        <section>
          <h2>{t("finance.revenueOverTime")}</h2>
          <p>{t("finance.chartsNotSoleSource")}</p>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("finance.date")}</th>
                <th>{t("finance.grossRevenue")}</th>
                <th>{t("finance.aiCogsOverTime")}</th>
                <th>{t("finance.realizedContribution")}</th>
              </tr>
            </thead>
            <tbody>
              {data.series.map((point) => (
                <tr key={point.date}>
                  <td>{point.date}</td>
                  <td>{formatMoney(point.grossRevenueMicroRub)}</td>
                  <td>{formatMoney(point.realizedAiCogsMicroRub)}</td>
                  <td>{formatMoney(point.realizedContributionMicroRub)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <p>{t("app.empty")}</p>
      )}
    </section>
  );
}
