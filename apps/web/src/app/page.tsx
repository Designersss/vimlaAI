import Link from "next/link";
import type { ReactElement } from "react";
import { getTranslations } from "next-intl/server";
import { BrandLockup, Heading, Text, buttonClassName } from "@vimla/ui";
import { fetchApiHealth } from "../shared/api/health";
import { HealthStatus } from "../features/health/components/HealthStatus/HealthStatus";
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
    <main className={styles.main} data-testid="landing-page">
      <div className={styles.ambient} aria-hidden="true" />
      <header className={styles.header}>
        <BrandLockup label={t("home.eyebrow")} />
        <LanguageSwitcher />
      </header>

      <section className={styles.hero} aria-labelledby="landing-heading">
        <div className={styles.copy}>
          <Text tone="caption">{t("home.eyebrow")}</Text>
          <Heading as="h1" size="display" id="landing-heading">
            {t("home.heading")}
          </Heading>
          <Text className={styles.tagline}>{t("home.tagline")}</Text>
          <div className={styles.actions}>
            <Link href="/sign-in" className={buttonClassName({ variant: "primary", size: "lg" })}>
              {t("nav.signIn")}
            </Link>
            <Link href="/sign-up" className={buttonClassName({ variant: "secondary", size: "lg" })}>
              {t("nav.signUp")}
            </Link>
          </div>
        </div>

        <aside className={styles.statusCard} aria-label={t("home.eyebrow")}>
          <div className={styles.statusHeader}>
            <Text tone="caption">Vimla</Text>
            <Text tone="secondary">AI workspace</Text>
          </div>
          <div className={styles.preview} aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <HealthStatus initialHealth={initialHealth} initialError={initialError} />
        </aside>
      </section>
    </main>
  );
}
