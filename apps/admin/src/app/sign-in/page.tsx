"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { adminAuthClient } from "../../shared/auth/auth-client";
import styles from "../admin/admin.module.scss";

export default function SignInPage() {
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const result = await adminAuthClient.signIn.email({ email, password });
    if (result.error) {
      setError(t("errors.unauthorized"));
      return;
    }
    const session = await adminAuthClient.getSession();
    const twoFactorEnabled =
      session.data?.user && "twoFactorEnabled" in session.data.user
        ? session.data.user.twoFactorEnabled === true
        : false;
    router.push(twoFactorEnabled ? "/elevate" : "/enroll");
  }

  return (
    <main className={styles.main}>
      <h1>{t("app.signIn")}</h1>
      <form className={styles.form} onSubmit={(event) => void onSubmit(event)}>
        <input className={styles.input} name="email" type="email" autoComplete="username" required />
        <input className={styles.input} name="password" type="password" autoComplete="current-password" required />
        <button className={styles.button} type="submit">
          {t("app.signIn")}
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </main>
  );
}
