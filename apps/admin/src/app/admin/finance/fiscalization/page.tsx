"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { adminFetch } from "../../../../shared/api/admin-fetch";
import styles from "../../admin.module.scss";

interface Fiscalization {
  id: string;
  provider: string;
  mode: string;
  percentageBps: number | null;
  sourceDescription: string;
  sourceQuality: string;
  verifiedAt: string | null;
  unverified: boolean;
}

export default function FiscalizationPage() {
  const t = useTranslations();
  const [current, setCurrent] = useState<Fiscalization | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function reload(): Promise<void> {
    const response = await adminFetch("/admin/v1/settings/economics");
    if (response.ok) {
      const body = (await response.json()) as { fiscalization: Fiscalization | null };
      setCurrent(body.fiscalization);
    }
  }

  useEffect(() => {
    void (async () => {
      const response = await adminFetch("/admin/v1/settings/economics");
      if (response.ok) {
        const body = (await response.json()) as { fiscalization: Fiscalization | null };
        setCurrent(body.fiscalization);
      }
    })();
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const percentage = String(form.get("percentageBps") ?? "");
    const response = await adminFetch("/admin/v1/settings/fiscalization", {
      method: "POST",
      body: JSON.stringify({
        provider: String(form.get("provider") ?? "tbank"),
        mode: String(form.get("mode") ?? "receipt"),
        percentageBps: percentage ? Number(percentage) : null,
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
      await adminFetch(`/admin/v1/settings/fiscalization/${created.id}/publish`, { method: "POST" });
      await reload();
    }
  }

  return (
    <section>
      <h1>{t("nav.fiscalization")}</h1>
      <p>{t("finance.fiscalizationNote")}</p>
      {current ? (
        <table className={styles.table}>
          <tbody>
            <tr>
              <th>provider/mode</th>
              <td>
                {current.provider} / {current.mode}
              </td>
            </tr>
            <tr>
              <th>percentageBps</th>
              <td>{current.percentageBps ?? "—"}</td>
            </tr>
            <tr>
              <th>source</th>
              <td>{current.sourceDescription}</td>
            </tr>
            <tr>
              <th>quality</th>
              <td className={current.unverified ? styles.warn : styles.ok}>{current.sourceQuality}</td>
            </tr>
            <tr>
              <th>verifiedAt</th>
              <td>{current.verifiedAt ?? "—"}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p className={styles.callout}>{t("finance.unverifiedFees")}</p>
      )}
      <form className={styles.form} onSubmit={(event) => void onSubmit(event)}>
        <input className={styles.input} name="provider" defaultValue="tbank" required />
        <input className={styles.input} name="mode" defaultValue="receipt" required />
        <input className={styles.input} name="percentageBps" type="number" placeholder="percentageBps" />
        <input className={styles.input} name="fixedFeeMicroRub" placeholder="fixedFee microRUB" />
        <input className={styles.input} name="sourceDescription" required />
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
