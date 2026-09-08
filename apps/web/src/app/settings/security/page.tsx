import type { ReactElement } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SecuritySettings } from "../../../features/auth/components/SecuritySettings/SecuritySettings";
import { LanguageSwitcher } from "../../../shared/i18n/LanguageSwitcher";
import styles from "../../page.module.scss";

export default async function SecurityPage(): Promise<ReactElement> {
  const t = await getTranslations();

  return (
    <main className={styles.main}>
      <LanguageSwitcher />
      <p className={styles.eyebrow}>{t("home.eyebrow")}</p>
      <h1 className={styles.heading}>{t("settings.securityTitle")}</h1>
      <p className={styles.copy}>
        <Link href="/app">{t("nav.chat")}</Link>
      </p>
      <SecuritySettings />
    </main>
  );
}
