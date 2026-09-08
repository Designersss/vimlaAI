"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { adminFetch } from "../../../../shared/api/admin-fetch";
import { formatMoney } from "../../../../shared/ui/format";
import styles from "../../admin.module.scss";

interface UserDetail {
  id: string;
  email: string;
  emailVerified: boolean;
  phoneNumber: string | null;
  phoneNumberVerified: boolean | null;
  createdAt: string;
  twoFactorEnabled: boolean;
  sessions: Array<{ id: string; createdAt: string; expiresAt: string }>;
  subscriptions: Array<{ id: string; status: string; periodEnd: string; planVersionId: string }>;
  usageBuckets: Array<{
    id: string;
    type: string;
    totalMicroRub: string;
    spentMicroRub: string;
    expiresAt: string | null;
  }>;
  payments: Array<{ id: string; status: string; kind: string; amountMicroRub: string; createdAt: string }>;
}

export default function UserDetailPage() {
  const t = useTranslations();
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<UserDetail | null>(null);

  useEffect(() => {
    void (async () => {
      const response = await adminFetch(`/admin/v1/users/${params.id}`);
      if (response.ok) {
        setData((await response.json()) as UserDetail);
      }
    })();
  }, [params.id]);

  if (!data) {
    return <p>{t("app.loading")}</p>;
  }

  return (
    <section>
      <h1>{t("nav.users")}</h1>
      <table className={styles.table}>
        <tbody>
          <tr>
            <th>ID</th>
            <td>{data.id}</td>
          </tr>
          <tr>
            <th>email</th>
            <td>{data.email}</td>
          </tr>
          <tr>
            <th>{t("explorer.verified")}</th>
            <td>{data.emailVerified ? t("explorer.verified") : t("explorer.unverified")}</td>
          </tr>
          <tr>
            <th>phone</th>
            <td>
              {data.phoneNumber ?? "—"} / {data.phoneNumberVerified ? t("explorer.verified") : t("explorer.unverified")}
            </td>
          </tr>
          <tr>
            <th>TOTP</th>
            <td>{data.twoFactorEnabled ? "yes" : "no"}</td>
          </tr>
        </tbody>
      </table>
      <h2>{t("explorer.sessions")}</h2>
      <p>{data.sessions.length}</p>
      <h2>{t("finance.usageObligations")}</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>type</th>
            <th>total</th>
            <th>spent</th>
            <th>expiresAt</th>
          </tr>
        </thead>
        <tbody>
          {data.usageBuckets.map((bucket) => (
            <tr key={bucket.id}>
              <td>{bucket.type}</td>
              <td>{formatMoney(bucket.totalMicroRub)}</td>
              <td>{formatMoney(bucket.spentMicroRub)}</td>
              <td>{bucket.type === "TOPUP" ? t("topup.noExpiry") : (bucket.expiresAt ?? "—")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>{t("nav.payments")}</h2>
      <table className={styles.table}>
        <tbody>
          {data.payments.map((payment) => (
            <tr key={payment.id}>
              <td>{payment.id.slice(0, 8)}</td>
              <td>{payment.status}</td>
              <td>{payment.kind}</td>
              <td>{formatMoney(payment.amountMicroRub)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
