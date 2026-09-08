import Link from "next/link";
import type { ReactElement } from "react";
import { getTranslations } from "next-intl/server";
import { fetchApiHealth } from "../shared/api/health";
import { HealthStatus } from "../features/health/components/HealthStatus/HealthStatus";
import { publicWebConfig } from "../shared/config/public-env";
import { LanguageSwitcher } from "../shared/i18n/LanguageSwitcher";
import styles from "./page.module.scss";

export const dynamic = "force-dynamic";

export default async function HomePage(): Promise<ReactElement> {
  const t = await getTranslations();
  let initialError: string | null = null;
  let initialHealth = null;

  try {
    initialHealth = await fetchApiHealth();
  } catch {
    initialError = t("health.failed");
  }

  return (
    <main className={styles.main}>
      <LanguageSwitcher />
      <p className={styles.eyebrow}>{t("home.eyebrow")}</p>
      <h1 className={styles.heading}>{t("home.heading")}</h1>
      <p className={styles.copy}>{t("home.apiBase", { url: publicWebConfig.apiBaseUrl })}</p>
      <p className={styles.copy}>
        <Link href="/sign-in">{t("nav.signIn")}</Link>
        {" · "}
        <Link href="/sign-up">{t("nav.signUp")}</Link>
      </p>
      <HealthStatus initialHealth={initialHealth} initialError={initialError} />
    </main>
  );
}
