"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { adminFetch } from "../../../../shared/api/admin-fetch";
import styles from "../../admin.module.scss";

interface FeeRow {
  id: string;
  provider: string;
  paymentMethod: string;
  feeBps: number;
  feeVatBps: number;
  sourceDescription: string;
  sourceQuality: string;
  verifiedAt: string | null;
  unverified: boolean;
}

interface Economics {
  merchantTariffConfigured: boolean;
  fees: FeeRow[];
}

export default function PaymentFeesPage() {
  const t = useTranslations();
  const [data, setData] = useState<Economics | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function reload(): Promise<void> {
    const response = await adminFetch("/admin/v1/settings/economics");
    if (response.ok) {
      setData((await response.json()) as Economics);
    }
  }

  useEffect(() => {
    void (async () => {
      const response = await adminFetch("/admin/v1/settings/economics");
      if (response.ok) {
        setData((await response.json()) as Economics);
      }
    })();
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await adminFetch("/admin/v1/settings/payment-fees", {
      method: "POST",
      body: JSON.stringify({
        provider: String(form.get("provider") ?? "tbank"),
        paymentMethod: String(form.get("paymentMethod") ?? "CARD"),
        feeBps: Number(form.get("feeBps")),
        feeVatBps: Number(form.get("feeVatBps")),
        minimumFeeMicroRub: String(form.get("minimumFeeMicroRub") ?? "") || null,
        fixedFeeMicroRub: String(form.get("fixedFeeMicroRub") ?? "") || null,
        sourceDescription: String(form.get("sourceDescription") ?? ""),
        sourceQuality: String(form.get("sourceQuality") ?? "UNVERIFIED"),
        verifiedAt: String(form.get("verifiedAt") ?? "")
          ? new Date(String(form.get("verifiedAt"))).toISOString()
          : null,
      }),
    });
    setMessage(response.ok ? t("app.save") : t("app.denied"));
    if (response.ok) {
      const created = (await response.json()) as { id: string };
      await adminFetch(`/admin/v1/settings/payment-fees/${created.id}/publish`, { method: "POST" });
      await reload();
    }
  }

  return (
    <section>
      <h1>{t("nav.paymentFees")}</h1>
      {data && !data.merchantTariffConfigured ? <p className={styles.callout}>{t("finance.unverifiedFees")}</p> : null}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>provider</th>
            <th>{t("finance.method")}</th>
            <th>feeBps</th>
            <th>VAT bps</th>
            <th>source</th>
            <th>quality</th>
            <th>verifiedAt</th>
          </tr>
        </thead>
        <tbody>
          {data?.fees.map((fee) => (
            <tr key={fee.id}>
              <td>{fee.provider}</td>
              <td>{fee.paymentMethod}</td>
              <td>{fee.feeBps}</td>
              <td>{fee.feeVatBps}</td>
              <td>{fee.sourceDescription}</td>
              <td className={fee.unverified ? styles.warn : styles.ok}>{fee.sourceQuality}</td>
              <td>{fee.verifiedAt ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>{t("app.createDraft")}</h2>
      <form className={styles.form} onSubmit={(event) => void onSubmit(event)}>
        <input className={styles.input} name="provider" defaultValue="tbank" required />
        <select className={styles.input} name="paymentMethod" defaultValue="CARD">
          <option>CARD</option>
          <option>SBP</option>
          <option>T_PAY</option>
          <option>OTHER</option>
        </select>
        <input className={styles.input} name="feeBps" type="number" placeholder="feeBps" required />
        <input className={styles.input} name="feeVatBps" type="number" placeholder="feeVatBps" required />
        <input className={styles.input} name="minimumFeeMicroRub" placeholder="minimumFee microRUB" />
        <input className={styles.input} name="fixedFeeMicroRub" placeholder="fixedFee microRUB" />
        <input className={styles.input} name="sourceDescription" placeholder="source" required />
        <select className={styles.input} name="sourceQuality" defaultValue="UNVERIFIED">
          <option>UNVERIFIED</option>
          <option>VERIFIED</option>
        </select>
        <input className={styles.input} name="verifiedAt" type="datetime-local" />
        <button className={styles.button} type="submit">
          {t("app.save")}
        </button>
      </form>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
