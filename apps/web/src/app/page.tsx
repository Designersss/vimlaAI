import Link from "next/link";
import type { ReactElement } from "react";
import { getTranslations } from "next-intl/server";
import { Heading, Text, buttonClassName } from "@vimla/ui";
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
    <main className={styles.main}>
      <LanguageSwitcher />
      <Text tone="caption">{t("home.eyebrow")}</Text>
      <Heading as="h1" size="page">
        {t("home.heading")}
      </Heading>
      <Text>{t("home.tagline")}</Text>
      <div className={styles.actions}>
        <Link href="/sign-in" className={buttonClassName({ variant: "primary" })}>
          {t("nav.signIn")}
        </Link>
        <Link href="/sign-up" className={buttonClassName({ variant: "secondary" })}>
          {t("nav.signUp")}
        </Link>
      </div>
      <HealthStatus initialHealth={initialHealth} initialError={initialError} />
    </main>
  );
}
