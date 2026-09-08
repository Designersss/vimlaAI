import type { ReactElement } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthForm } from "../../features/auth/components/AuthForm/AuthForm";
import { LanguageSwitcher } from "../../shared/i18n/LanguageSwitcher";
import styles from "../page.module.scss";

export default async function SignUpPage(): Promise<ReactElement> {
  const t = await getTranslations();

  return (
    <main className={styles.main}>
      <LanguageSwitcher />
      <p className={styles.eyebrow}>{t("home.eyebrow")}</p>
      <h1 className={styles.heading}>{t("auth.signUp")}</h1>
      <AuthForm mode="sign-up" />
      <p className={styles.copy}>
        {t("auth.hasAccount")} <Link href="/sign-in">{t("auth.signIn")}</Link>
      </p>
    </main>
  );
}
