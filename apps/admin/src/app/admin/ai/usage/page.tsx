"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { adminFetch } from "../../../../shared/api/admin-fetch";
import { formatMoney, presetRange } from "../../../../shared/ui/format";
import styles from "../../admin.module.scss";

interface ModelRow {
  slug: string;
  requestCount: number;
  inputTokens: string;
  outputTokens: string;
  providerActualCostMicroRub: string;
  userSettledUsageMicroRub: string;
  differenceMicroRub: string;
}

export default function AiUsagePage() {
  const t = useTranslations();
  const [rows, setRows] = useState<ModelRow[]>([]);

  useEffect(() => {
    void (async () => {
      const range = presetRange("Europe/Moscow", "30");
      const params = new URLSearchParams({ from: range.from, to: range.to, timezone: "Europe/Moscow" });
      const response = await adminFetch(`/admin/v1/finance/overview?${params.toString()}`);
      if (response.ok) {
        const body = (await response.json()) as { models?: ModelRow[] };
        setRows(body.models ?? []);
      }
    })();
  }, []);

  return (
    <section>
      <h1>{t("nav.aiUsage")}</h1>
      <p>{t("finance.modelEconomics")}</p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t("finance.model")}</th>
            <th>{t("finance.requests")}</th>
            <th>{t("finance.providerCogs")}</th>
            <th>{t("finance.userUsage")}</th>
            <th>{t("finance.difference")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.slug}>
              <td>{row.slug}</td>
              <td>{row.requestCount}</td>
              <td>{formatMoney(row.providerActualCostMicroRub)}</td>
              <td>{formatMoney(row.userSettledUsageMicroRub)}</td>
              <td>{formatMoney(row.differenceMicroRub)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <p>{t("app.empty")}</p> : null}
    </section>
  );
}
