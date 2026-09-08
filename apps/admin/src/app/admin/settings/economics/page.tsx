"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { adminFetch } from "../../../../shared/api/admin-fetch";
import styles from "../../admin.module.scss";

interface Economics {
  guardrail: {
    id: string;
    targetMinimumMarginBps: number;
    projectCreationWindowDays: number | null;
    projectCreationLimitFree: number | null;
    projectCreationLimit199: number | null;
    projectCreationLimit499: number | null;
    projectCreationLimit999: number | null;
    freeActiveProjectReallocationCooldownDays: number | null;
    projectTrashRetentionDays: number | null;
    sourceQuality: string;
  } | null;
  taxReserve: {
    id: string;
    reserveBps: number;
    enabled: boolean;
    sourceQuality: string;
  } | null;
}

export default function EconomicsPage() {
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

  async function saveGuardrail(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nullableInt = (name: string): number | null => {
      const value = String(form.get(name) ?? "").trim();
      return value ? Number(value) : null;
    };
    const response = await adminFetch("/admin/v1/settings/economics/guardrails", {
      method: "POST",
      body: JSON.stringify({
        targetMinimumMarginBps: Number(form.get("targetMinimumMarginBps")),
        projectCreationWindowDays: nullableInt("projectCreationWindowDays"),
        projectCreationLimitFree: nullableInt("projectCreationLimitFree"),
        projectCreationLimit199: nullableInt("projectCreationLimit199"),
        projectCreationLimit499: nullableInt("projectCreationLimit499"),
        projectCreationLimit999: nullableInt("projectCreationLimit999"),
        freeActiveProjectReallocationCooldownDays: nullableInt("freeActiveProjectReallocationCooldownDays"),
        projectTrashRetentionDays: nullableInt("projectTrashRetentionDays"),
        sourceQuality: "UNVERIFIED",
      }),
    });
    setMessage(response.ok ? t("app.save") : t("app.denied"));
    if (response.ok) {
      const created = (await response.json()) as { id: string };
      await adminFetch(`/admin/v1/settings/economics/guardrails/${created.id}/publish`, { method: "POST" });
      await reload();
    }
  }

  async function saveTax(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await adminFetch("/admin/v1/settings/tax-reserve", {
      method: "POST",
      body: JSON.stringify({
        reserveBps: Number(form.get("reserveBps")),
        enabled: form.get("enabled") === "true",
        sourceQuality: "ESTIMATE",
      }),
    });
    setMessage(response.ok ? t("app.save") : t("app.denied"));
    if (response.ok) {
      const created = (await response.json()) as { id: string };
      await adminFetch(`/admin/v1/settings/tax-reserve/${created.id}/publish`, { method: "POST" });
      await reload();
    }
  }

  return (
    <section>
      <h1>{t("nav.economics")}</h1>
      <p>{t("finance.taxReserveEstimate")}</p>
      <p>{t("settings.churnSeparate")}</p>
      {data?.guardrail ? (
        <table className={styles.table}>
          <tbody>
            <tr>
              <th>targetMinimumMarginBps</th>
              <td>{data.guardrail.targetMinimumMarginBps}</td>
            </tr>
            <tr>
              <th>projectCreationWindowDays</th>
              <td>{data.guardrail.projectCreationWindowDays ?? "TBD"}</td>
            </tr>
            <tr>
              <th>sourceQuality</th>
              <td>{data.guardrail.sourceQuality}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p>{t("app.empty")}</p>
      )}
      <form className={styles.form} onSubmit={(event) => void saveGuardrail(event)}>
        <input className={styles.input} name="targetMinimumMarginBps" type="number" defaultValue={data?.guardrail?.targetMinimumMarginBps ?? 2000} required />
        <input className={styles.input} name="projectCreationWindowDays" type="number" placeholder="projectCreationWindowDays" />
        <input className={styles.input} name="projectCreationLimitFree" type="number" placeholder="projectCreationLimitFree" />
        <input className={styles.input} name="projectCreationLimit199" type="number" placeholder="projectCreationLimit199" />
        <input className={styles.input} name="projectCreationLimit499" type="number" placeholder="projectCreationLimit499" />
        <input className={styles.input} name="projectCreationLimit999" type="number" placeholder="projectCreationLimit999" />
        <input className={styles.input} name="freeActiveProjectReallocationCooldownDays" type="number" placeholder="reallocation cooldown" />
        <input className={styles.input} name="projectTrashRetentionDays" type="number" placeholder="trash retention" />
        <button className={styles.button} type="submit">
          {t("app.save")}
        </button>
      </form>
      <h2>{t("finance.taxReserve")}</h2>
      <p className={styles.callout}>{t("finance.taxReserveEstimate")}</p>
      {data?.taxReserve ? (
        <p>
          {data.taxReserve.enabled ? data.taxReserve.reserveBps : "off"} bps · {data.taxReserve.sourceQuality}
        </p>
      ) : (
        <p>{t("app.empty")}</p>
      )}
      <form className={styles.form} onSubmit={(event) => void saveTax(event)}>
        <input className={styles.input} name="reserveBps" type="number" defaultValue={data?.taxReserve?.reserveBps ?? 0} required />
        <select className={styles.input} name="enabled" defaultValue={data?.taxReserve?.enabled ? "true" : "false"}>
          <option value="false">off</option>
          <option value="true">on</option>
        </select>
        <button className={styles.button} type="submit">
          {t("app.save")}
        </button>
      </form>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
