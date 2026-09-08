import type { ReactElement } from "react";
import { getTranslations } from "next-intl/server";
import { VerifyEmailForm } from "../../features/auth/components/VerifyEmailForm/VerifyEmailForm";
import { LanguageSwitcher } from "../../shared/i18n/LanguageSwitcher";
import styles from "../page.module.scss";

export default async function VerifyEmailPage(): Promise<ReactElement> {
  const t = await getTranslations();

  return (
    <main className={styles.main}>
      <LanguageSwitcher />
      <p className={styles.eyebrow}>{t("home.eyebrow")}</p>
      <h1 className={styles.heading}>{t("auth.verifyEmail.title")}</h1>
      <VerifyEmailForm />
    </main>
  );
}
