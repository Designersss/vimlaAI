import type { ReactElement } from "react";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { ResetPasswordForm } from "../../features/auth/components/ResetPasswordForm/ResetPasswordForm";
import { LanguageSwitcher } from "../../shared/i18n/LanguageSwitcher";
import styles from "../page.module.scss";

export default async function ResetPasswordPage(): Promise<ReactElement> {
  const t = await getTranslations();

  return (
    <main className={styles.main}>
      <LanguageSwitcher />
      <p className={styles.eyebrow}>{t("home.eyebrow")}</p>
      <h1 className={styles.heading}>{t("auth.reset.title")}</h1>
      <Suspense fallback={<p>{t("common.loading")}</p>}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
