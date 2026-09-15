"use client";

import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronLeftIcon, Heading, buttonClassName } from "@vimla/ui";
import styles from "./SettingsChrome.module.scss";

export function SettingsChrome({ title, children }: { title: string; children: ReactNode }): ReactElement {
  const t = useTranslations();

  return (
    <div className={styles.section} data-testid="settings-detail">
      <div className={styles.sectionHeader}>
        <Link
          href="/settings"
          scroll={false}
          aria-label={t("common.back")}
          className={`${buttonClassName({ variant: "ghost", size: "sm" })} ${styles.mobileBack}`}
        >
          <ChevronLeftIcon size={16} aria-hidden="true" />
          {t("common.back")}
        </Link>
        <Heading as="h1" size="page" className={styles.sectionTitle}>
          {title}
        </Heading>
      </div>
      {children}
    </div>
  );
}
