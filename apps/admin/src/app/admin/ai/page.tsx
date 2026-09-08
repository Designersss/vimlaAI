"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { adminFetch } from "../../../shared/api/admin-fetch";
import styles from "../admin.module.scss";

interface AiPayload {
  status: { envEnabled: boolean; operatorDisabled: boolean; secrets: { proxyapi: boolean; tbank: boolean; smtp: boolean } };
  models: Array<{
    id: string;
    slug: string;
    displayName: string;
    vendor: string;
    active: boolean;
    prices: Array<{
      id: string;
      effectiveFrom: string;
      effectiveTo: string | null;
      inputMicroRubPerMillion: string;
      outputMicroRubPerMillion: string;
      cacheReadMicroRubPerMillion: string | null;
      cacheWriteMicroRubPerMillion: string | null;
    }>;
  }>;
}

export default function AiPage() {
  const t = useTranslations();
  const [data, setData] = useState<AiPayload | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function reload(): Promise<void> {
    const response = await adminFetch("/admin/v1/ai");
    if (response.ok) {
      setData((await response.json()) as AiPayload);
    }
  }

  useEffect(() => {
    void (async () => {
      const response = await adminFetch("/admin/v1/ai");
      if (response.ok) {
        setData((await response.json()) as AiPayload);
      }
    })();
  }, []);

  async function toggleKill(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await adminFetch("/admin/v1/ai/kill-switch", {
      method: "POST",
      body: JSON.stringify({
        disabled: form.get("disabled") === "true",
        reason: String(form.get("reason") ?? ""),
      }),
    });
    setMessage(response.ok ? t("app.confirm") : t("app.denied"));
    if (response.ok) {
      await reload();
    }
  }

  if (!data) {
    return <p>{t("app.loading")}</p>;
  }

  return (
    <section>
      <h1>{t("nav.ai")}</h1>
      <p>
        ProxyAPI: {data.status.secrets.proxyapi ? t("secrets.configured") : t("secrets.missing")} · T-Bank:{" "}
        {data.status.secrets.tbank ? t("secrets.configured") : t("secrets.missing")} · SMTP:{" "}
        {data.status.secrets.smtp ? t("secrets.configured") : t("secrets.missing")}
      </p>
      <p>
        env AI: {String(data.status.envEnabled)} · operator kill: {String(data.status.operatorDisabled)}
      </p>
      <form className={styles.form} onSubmit={(event) => void toggleKill(event)}>
        <select className={styles.input} name="disabled" defaultValue={data.status.operatorDisabled ? "true" : "false"}>
          <option value="false">{t("ai.enabled")}</option>
          <option value="true">{t("ai.disabled")}</option>
        </select>
        <input className={styles.input} name="reason" placeholder={t("app.reason")} required minLength={3} />
        <button className={styles.button} type="submit">
          {t("ai.killSwitch")}
        </button>
      </form>
      {message ? <p role="status">{message}</p> : null}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>model</th>
            <th>vendor</th>
            <th>active</th>
            <th>input / output</th>
            <th>effectiveFrom</th>
          </tr>
        </thead>
        <tbody>
          {data.models.map((model) => {
            const price = model.prices[0];
            return (
              <tr key={model.id}>
                <td>{model.slug}</td>
                <td>{model.vendor}</td>
                <td>{String(model.active)}</td>
                <td>
                  {price ? `${price.inputMicroRubPerMillion} / ${price.outputMicroRubPerMillion}` : "—"}
                </td>
                <td>{price?.effectiveFrom ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>{t("ai.priceReadOnly")}</p>
    </section>
  );
}
