"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { adminAuthClient } from "../../shared/auth/auth-client";
import styles from "../admin/admin.module.scss";

export default function EnrollPage() {
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  async function enableTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const result = await adminAuthClient.twoFactor.enable({ password });
    if (result.error || !result.data) {
      setError(t("app.denied"));
      return;
    }
    if ("totpURI" in result.data && typeof result.data.totpURI === "string") {
      setTotpUri(result.data.totpURI);
    }
    if ("backupCodes" in result.data && Array.isArray(result.data.backupCodes)) {
      setBackupCodes(result.data.backupCodes.filter((item): item is string => typeof item === "string"));
    }
  }

  async function verifyTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = String(form.get("totpCode") ?? "");
    const result = await adminAuthClient.twoFactor.verifyTotp({ code });
    if (result.error) {
      setError(t("app.denied"));
      return;
    }
    router.push("/elevate");
  }

  async function addPasskey() {
    const result = await adminAuthClient.passkey.addPasskey({ name: "Vimla Admin" });
    if (result?.error) {
      setError(t("app.denied"));
    }
  }

  return (
    <main className={styles.main}>
      <h1>{t("app.enroll")}</h1>
      <form className={styles.form} onSubmit={(event) => void enableTotp(event)}>
        <input className={styles.input} name="password" type="password" autoComplete="current-password" required />
        <button className={styles.button} type="submit">
          {t("app.enroll")}
        </button>
      </form>
      {totpUri ? (
        <p>
          {t("app.totpUri")}: <code>{totpUri}</code>
        </p>
      ) : null}
      {backupCodes ? (
        <section>
          <p>{t("app.backupCodesOnce")}</p>
          <pre>{backupCodes.join("\n")}</pre>
        </section>
      ) : null}
      <form className={styles.form} onSubmit={(event) => void verifyTotp(event)}>
        <input className={styles.input} name="totpCode" inputMode="numeric" required />
        <button className={styles.button} type="submit">
          {t("app.verifyTotp")}
        </button>
      </form>
      <button type="button" className={styles.button} onClick={() => void addPasskey()}>
        {t("app.addPasskey")}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}
