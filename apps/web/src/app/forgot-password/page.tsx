import type { ReactElement } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ForgotPasswordForm } from "../../features/auth/components/ForgotPasswordForm/ForgotPasswordForm";
import { LanguageSwitcher } from "../../shared/i18n/LanguageSwitcher";
import styles from "../page.module.scss";

export default async function ForgotPasswordPage(): Promise<ReactElement> {
  const t = await getTranslations();

  return (
    <main className={styles.main}>
      <LanguageSwitcher />
      <p className={styles.eyebrow}>{t("home.eyebrow")}</p>
      <h1 className={styles.heading}>{t("auth.forgot.title")}</h1>
      <ForgotPasswordForm />
      <p className={styles.copy}>
        <Link href="/sign-in">{t("auth.signIn")}</Link>
      </p>
    </main>
  );
}
