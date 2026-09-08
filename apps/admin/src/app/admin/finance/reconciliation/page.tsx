"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { adminFetch } from "../../../../shared/api/admin-fetch";
import { formatMoney } from "../../../../shared/ui/format";
import styles from "../../admin.module.scss";

interface Queue {
  missingEconomics: Array<{ id: string; status: string; kind: string; amountMicroRub: string; createdAt: string }>;
  flagged: Array<{ paymentId: string; economicsStatus: string; paymentMethod: string; paymentFeePolicyVersionId: string | null }>;
  note: string;
}

export default function ReconciliationPage() {
  const t = useTranslations();
  const [data, setData] = useState<Queue | null>(null);

  useEffect(() => {
    void (async () => {
      const response = await adminFetch("/admin/v1/finance/reconciliation");
      if (response.ok) {
        setData((await response.json()) as Queue);
      }
    })();
  }, []);

  if (!data) {
    return <p>{t("app.loading")}</p>;
  }

  return (
    <section>
      <h1>{t("nav.reconciliation")}</h1>
      <p className={styles.callout}>{data.note}</p>
      <h2>{t("explorer.missingEconomics")}</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>ID</th>
            <th>{t("explorer.status")}</th>
            <th>{t("explorer.kind")}</th>
            <th>{t("finance.grossRevenue")}</th>
          </tr>
        </thead>
        <tbody>
          {data.missingEconomics.map((row) => (
            <tr key={row.id}>
              <td>
                <Link href={`/admin/finance/payments/${row.id}`}>{row.id.slice(0, 8)}</Link>
              </td>
              <td>{row.status}</td>
              <td>{row.kind}</td>
              <td>{formatMoney(row.amountMicroRub)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.missingEconomics.length === 0 ? <p>{t("app.empty")}</p> : null}
      <h2>{t("explorer.flaggedEconomics")}</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>payment</th>
            <th>{t("explorer.reconciliation")}</th>
            <th>{t("finance.method")}</th>
            <th>feePolicy</th>
          </tr>
        </thead>
        <tbody>
          {data.flagged.map((row) => (
            <tr key={row.paymentId}>
              <td>
                <Link href={`/admin/finance/payments/${row.paymentId}`}>{row.paymentId.slice(0, 8)}</Link>
              </td>
              <td>{row.economicsStatus}</td>
              <td className={row.paymentMethod === "UNKNOWN" ? styles.danger : undefined}>{row.paymentMethod}</td>
              <td>{row.paymentFeePolicyVersionId ?? t("finance.unverifiedFees")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
