"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { adminFetch } from "../../shared/api/admin-fetch";
import { adminAuthClient } from "../../shared/auth/auth-client";
import styles from "../admin/admin.module.scss";

export default function ElevatePage() {
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const totpCode = String(form.get("totpCode") ?? "");
    const backupCode = String(form.get("backupCode") ?? "");
    if (!totpCode && !backupCode) {
      setError(t("app.denied"));
      return;
    }
    if (totpCode) {
      await adminAuthClient.twoFactor.verifyTotp({ code: totpCode });
    } else if (backupCode) {
      await adminAuthClient.twoFactor.verifyBackupCode({ code: backupCode });
    }
    const response = await adminFetch("/admin/v1/auth/elevate", {
      method: "POST",
      body: JSON.stringify(totpCode ? { totpCode } : { backupCode }),
    });
    if (!response.ok) {
      setError(t("app.denied"));
      return;
    }
    router.push("/admin");
  }

  return (
    <main className={styles.main}>
      <h1>{t("app.elevate")}</h1>
      <form className={styles.form} onSubmit={(event) => void onSubmit(event)}>
        <input className={styles.input} name="totpCode" inputMode="numeric" autoComplete="one-time-code" />
        <input className={styles.input} name="backupCode" autoComplete="off" />
        <button className={styles.button} type="submit">
          {t("app.elevate")}
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </main>
  );
}
