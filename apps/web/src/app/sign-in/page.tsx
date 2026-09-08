"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AuthForm } from "../../features/auth/components/AuthForm/AuthForm";
import { PhoneSignInForm } from "../../features/auth/components/PhoneSignInForm/PhoneSignInForm";
import { LanguageSwitcher } from "../../shared/i18n/LanguageSwitcher";
import { useState } from "react";
import styles from "../page.module.scss";

export default function SignInPage(): ReactElement {
  const t = useTranslations();
  const [tab, setTab] = useState<"email" | "phone">("email");

  return (
    <main className={styles.main}>
      <LanguageSwitcher />
      <p className={styles.eyebrow}>{t("home.eyebrow")}</p>
      <h1 className={styles.heading}>{t("auth.signIn")}</h1>
      <div className={styles.copy} role="tablist" aria-label={t("auth.signIn")}>
        <button type="button" role="tab" aria-selected={tab === "email"} onClick={() => setTab("email")}>
          {t("auth.emailTab")}
        </button>
        {" · "}
        <button type="button" role="tab" aria-selected={tab === "phone"} onClick={() => setTab("phone")}>
          {t("auth.phoneTab")}
        </button>
      </div>
      {tab === "email" ? <AuthForm mode="sign-in" /> : <PhoneSignInForm />}
      {tab === "email" ? (
        <p className={styles.copy}>
          <Link href="/forgot-password">{t("auth.forgotPassword")}</Link>
        </p>
      ) : null}
      <p className={styles.copy}>
        {t("auth.noAccount")} <Link href="/sign-up">{t("auth.createOne")}</Link>
      </p>
    </main>
  );
}
