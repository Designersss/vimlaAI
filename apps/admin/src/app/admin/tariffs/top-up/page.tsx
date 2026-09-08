"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { adminFetch } from "../../../../shared/api/admin-fetch";
import { formatBps, formatMoney } from "../../../../shared/ui/format";
import styles from "../../admin.module.scss";

interface TopupPolicy {
  id: string;
  status: string;
  minPurchaseMicroRub: string;
  maxPurchaseMicroRub: string;
  usageGrantRatioBps: number;
}

interface Simulation {
  grantMicroRub: string;
  methods: Array<{
    paymentMethod: string;
    conservativeMarginBps: number | null;
    conservativeContributionMicroRub: string;
    guardrail: string;
  }>;
  worstCase: { paymentMethod: string; conservativeMarginBps: number | null; guardrail: string } | null;
}

export default function TopupPage() {
  const t = useTranslations();
  const [current, setCurrent] = useState<TopupPolicy | null>(null);
  const [versions, setVersions] = useState<TopupPolicy[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<Simulation | null>(null);

  async function reload(): Promise<void> {
    const response = await adminFetch("/admin/v1/tariffs/top-up");
    if (!response.ok) {
      return;
    }
    const body = (await response.json()) as {
      current: TopupPolicy | null;
      versions: TopupPolicy[];
      expirySupported: boolean;
    };
    setCurrent(body.current);
    setVersions(body.versions);
  }

  useEffect(() => {
    void (async () => {
      const response = await adminFetch("/admin/v1/tariffs/top-up");
      if (!response.ok) {
        return;
      }
      const body = (await response.json()) as {
        current: TopupPolicy | null;
        versions: TopupPolicy[];
        expirySupported: boolean;
      };
      setCurrent(body.current);
      setVersions(body.versions);
    })();
  }, []);

  async function saveDraft(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await adminFetch("/admin/v1/tariffs/top-up/drafts", {
      method: "POST",
      body: JSON.stringify({
        minPurchaseMicroRub: String(form.get("minPurchaseMicroRub") ?? ""),
        maxPurchaseMicroRub: String(form.get("maxPurchaseMicroRub") ?? ""),
        usageGrantRatioBps: Number(form.get("usageGrantRatioBps")),
      }),
    });
    setMessage(response.ok ? t("app.save") : t("app.denied"));
    if (response.ok) {
      await reload();
    }
  }

  async function publish(id: string): Promise<void> {
    const response = await adminFetch(`/admin/v1/tariffs/top-up/${id}/publish`, { method: "POST" });
    setMessage(response.ok ? t("app.publish") : t("app.denied"));
    if (response.ok) {
      await reload();
    }
  }

  async function simulate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rub = BigInt(String(form.get("amountRub") ?? "0"));
    const response = await adminFetch("/admin/v1/tariffs/top-up/simulate", {
      method: "POST",
      body: JSON.stringify({
        amountMicroRub: (rub * 1_000_000n).toString(),
        usageGrantRatioBps: Number(form.get("simRatio") ?? current?.usageGrantRatioBps ?? 0),
      }),
    });
    if (!response.ok) {
      setMessage(t("app.denied"));
      return;
    }
    setSimulation((await response.json()) as Simulation);
  }

  return (
    <section>
      <h1>{t("topup.title")}</h1>
      <p data-testid="topup-no-expiry">{t("topup.noExpiry")}</p>
      {current ? (
        <table className={styles.table}>
          <tbody>
            <tr>
              <th>min</th>
              <td>{formatMoney(current.minPurchaseMicroRub)}</td>
            </tr>
            <tr>
              <th>max</th>
              <td>{formatMoney(current.maxPurchaseMicroRub)}</td>
            </tr>
            <tr>
              <th>usageGrantRatioBps</th>
              <td>{current.usageGrantRatioBps}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p>{t("app.empty")}</p>
      )}
      <form className={styles.form} onSubmit={(event) => void saveDraft(event)}>
        <input className={styles.input} name="minPurchaseMicroRub" defaultValue={current?.minPurchaseMicroRub ?? "100000000"} required />
        <input className={styles.input} name="maxPurchaseMicroRub" defaultValue={current?.maxPurchaseMicroRub ?? "100000000000"} required />
        <input className={styles.input} name="usageGrantRatioBps" type="number" defaultValue={current?.usageGrantRatioBps ?? 7500} required />
        <button className={styles.button} type="submit">
          {t("app.save")}
        </button>
      </form>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>status</th>
            <th>ratio</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {versions.map((version) => (
            <tr key={version.id}>
              <td>{version.status}</td>
              <td>{version.usageGrantRatioBps}</td>
              <td>
                {version.status === "DRAFT" ? (
                  <button type="button" className={styles.button} onClick={() => void publish(version.id)}>
                    {t("app.publish")}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>{t("nav.simulator")}</h2>
      <form className={styles.form} onSubmit={(event) => void simulate(event)}>
        <input className={styles.input} name="amountRub" type="number" defaultValue="1000" required />
        <input className={styles.input} name="simRatio" type="number" defaultValue={current?.usageGrantRatioBps ?? 7500} required />
        <button className={styles.button} type="submit">
          {t("app.simulate")}
        </button>
      </form>
      {simulation ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t("finance.method")}</th>
              <th>{t("finance.conservativeMargin")}</th>
              <th>guardrail</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>{t("topup.grant")}</th>
              <td colSpan={2}>{formatMoney(simulation.grantMicroRub)}</td>
            </tr>
            {simulation.methods.map((row) => (
              <tr key={row.paymentMethod}>
                <td>{row.paymentMethod}</td>
                <td>{formatBps(row.conservativeMarginBps)}</td>
                <td className={row.guardrail === "NEGATIVE" ? styles.danger : row.guardrail === "WARNING" ? styles.warn : undefined}>
                  {row.guardrail}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
