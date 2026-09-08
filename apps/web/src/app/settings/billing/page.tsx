import type { ReactElement } from "react";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "../../../shared/i18n/LanguageSwitcher";
import { BillingSettings } from "../../../features/billing/components/BillingSettings/BillingSettings";
import styles from "../../page.module.scss";

export default async function BillingPage(): Promise<ReactElement> {
  const t = await getTranslations();

  return (
    <main className={styles.main}>
      <LanguageSwitcher />
      <p className={styles.eyebrow}>{t("home.eyebrow")}</p>
      <h1 className={styles.heading}>{t("billing.title")}</h1>
      <BillingSettings />
    </main>
  );
}
