"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { adminFetch } from "../../../../../shared/api/admin-fetch";
import { formatMoney } from "../../../../../shared/ui/format";
import styles from "../../../admin.module.scss";

interface PaymentDetail {
  id: string;
  userId: string;
  status: string;
  kind: string;
  amountMicroRub: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  createdAt: string;
  checkoutSnapshot: unknown;
  economics: {
    paymentMethod: string;
    economicsStatus: string;
    estimatedAcquiringFeeMicroRub: string | null;
    actualAcquiringFeeMicroRub: string | null;
    estimatedFiscalizationFeeMicroRub: string | null;
    actualFiscalizationFeeMicroRub: string | null;
    refundedAmountMicroRub: string;
    chargebackAmountMicroRub: string;
  } | null;
  events: Array<{ id: string; type: string; createdAt: string }>;
}

export default function PaymentDetailPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<PaymentDetail | null>(null);

  useEffect(() => {
    void (async () => {
      const response = await adminFetch(`/admin/v1/payments/${params.id}`);
      if (response.ok) {
        setData((await response.json()) as PaymentDetail);
      }
    })();
  }, [params.id]);

  if (!data) {
    return <p>{t("app.loading")}</p>;
  }

  return (
    <section>
      <h1>{t("nav.payments")}</h1>
      <table className={styles.table}>
        <tbody>
          <tr>
            <th>ID</th>
            <td>{data.id}</td>
          </tr>
          <tr>
            <th>{t("explorer.userId")}</th>
            <td>{data.userId}</td>
          </tr>
          <tr>
            <th>{t("explorer.status")}</th>
            <td>{data.status}</td>
          </tr>
          <tr>
            <th>{t("explorer.kind")}</th>
            <td>{data.kind}</td>
          </tr>
          <tr>
            <th>{t("finance.grossRevenue")}</th>
            <td>{formatMoney(data.amountMicroRub)}</td>
          </tr>
          <tr>
            <th>providerOrderId</th>
            <td>{data.providerOrderId ?? "—"}</td>
          </tr>
          <tr>
            <th>providerPaymentId</th>
            <td>{data.providerPaymentId ?? "—"}</td>
          </tr>
        </tbody>
      </table>
      {data.economics ? (
        <section>
          <h2>PaymentEconomics</h2>
          <table className={styles.table}>
            <tbody>
              <tr>
                <th>{t("finance.method")}</th>
                <td>{data.economics.paymentMethod}</td>
              </tr>
              <tr>
                <th>{t("explorer.reconciliation")}</th>
                <td>{data.economics.economicsStatus}</td>
              </tr>
              <tr>
                <th>{t("finance.paymentCosts")} ({t("finance.qualityEstimated")})</th>
                <td>{formatMoney(data.economics.estimatedAcquiringFeeMicroRub)}</td>
              </tr>
              <tr>
                <th>{t("finance.paymentCosts")} ({t("finance.qualityActual")})</th>
                <td>{formatMoney(data.economics.actualAcquiringFeeMicroRub)}</td>
              </tr>
              <tr>
                <th>{t("finance.refunds")}</th>
                <td>{formatMoney(data.economics.refundedAmountMicroRub)}</td>
              </tr>
              <tr>
                <th>{t("finance.chargebacks")}</th>
                <td>{formatMoney(data.economics.chargebackAmountMicroRub)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      ) : null}
      <h2>{t("explorer.events")}</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>type</th>
            <th>{t("finance.date")}</th>
          </tr>
        </thead>
        <tbody>
          {data.events.map((event) => (
            <tr key={event.id}>
              <td>{event.type}</td>
              <td>{event.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
