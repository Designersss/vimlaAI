"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { adminFetch } from "../../../../shared/api/admin-fetch";
import { formatMoney } from "../../../../shared/ui/format";
import styles from "../../admin.module.scss";

interface PaymentRow {
  id: string;
  userId: string;
  status: string;
  kind: string;
  amountMicroRub: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  createdAt: string;
  paymentMethod: string | null;
  economicsStatus: string | null;
}

export default function PaymentsPage() {
  const t = useTranslations();
  const [items, setItems] = useState<PaymentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [query, setQuery] = useState<Record<string, string>>({});

  async function load(nextSkip = 0, filters = query): Promise<void> {
    const params = new URLSearchParams({ limit: "50", offset: String(nextSkip), ...filters });
    const response = await adminFetch(`/admin/v1/payments?${params.toString()}`);
    if (!response.ok) {
      return;
    }
    const body = (await response.json()) as { items: PaymentRow[]; total: number; skip: number };
    setItems(body.items);
    setTotal(body.total);
    setSkip(body.skip);
  }

  useEffect(() => {
    void (async () => {
      const params = new URLSearchParams({ limit: "50", offset: "0" });
      const response = await adminFetch(`/admin/v1/payments?${params.toString()}`);
      if (!response.ok) {
        return;
      }
      const body = (await response.json()) as { items: PaymentRow[]; total: number; skip: number };
      setItems(body.items);
      setTotal(body.total);
      setSkip(body.skip);
    })();
  }, []);

  function onSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next: Record<string, string> = {};
    for (const key of [
      "paymentId",
      "providerOrderId",
      "providerPaymentId",
      "userId",
      "status",
      "kind",
      "paymentMethod",
      "reconciliationStatus",
      "from",
      "to",
    ]) {
      const value = String(form.get(key) ?? "").trim();
      if (value) {
        next[key] = value;
      }
    }
    setQuery(next);
    void load(0, next);
  }

  return (
    <section>
      <h1>{t("nav.payments")}</h1>
      <form className={styles.filters} onSubmit={onSearch}>
        <input className={styles.input} name="paymentId" placeholder={t("explorer.paymentId")} />
        <input className={styles.input} name="providerOrderId" placeholder={t("explorer.providerOrderId")} />
        <input className={styles.input} name="providerPaymentId" placeholder={t("explorer.providerPaymentId")} />
        <input className={styles.input} name="userId" placeholder={t("explorer.userId")} />
        <input className={styles.input} name="status" placeholder="status" />
        <input className={styles.input} name="kind" placeholder="kind" />
        <input className={styles.input} name="paymentMethod" placeholder="CARD/SBP/T_PAY" />
        <input className={styles.input} name="reconciliationStatus" placeholder={t("explorer.reconciliation")} />
        <input className={styles.input} name="from" type="datetime-local" />
        <input className={styles.input} name="to" type="datetime-local" />
        <button className={styles.button} type="submit">
          {t("explorer.search")}
        </button>
      </form>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>ID</th>
            <th>{t("explorer.status")}</th>
            <th>{t("explorer.kind")}</th>
            <th>{t("finance.method")}</th>
            <th>{t("finance.grossRevenue")}</th>
            <th>{t("explorer.reconciliation")}</th>
            <th>{t("finance.date")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <Link href={`/admin/finance/payments/${item.id}`}>{item.id.slice(0, 8)}</Link>
              </td>
              <td>{item.status}</td>
              <td>{item.kind}</td>
              <td className={item.paymentMethod === "UNKNOWN" ? styles.danger : undefined}>
                {item.paymentMethod ?? "—"}
              </td>
              <td>{formatMoney(item.amountMicroRub)}</td>
              <td>{item.economicsStatus ?? "—"}</td>
              <td>{item.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 ? <p>{t("app.empty")}</p> : null}
      <div className={styles.filters}>
        <button type="button" className={styles.button} disabled={skip <= 0} onClick={() => void load(Math.max(0, skip - 50))}>
          {t("explorer.prev")}
        </button>
        <span>
          {skip + 1}–{Math.min(skip + items.length, total)} / {total}
        </span>
        <button
          type="button"
          className={styles.button}
          disabled={skip + items.length >= total}
          onClick={() => void load(skip + 50)}
        >
          {t("explorer.next")}
        </button>
      </div>
    </section>
  );
}
