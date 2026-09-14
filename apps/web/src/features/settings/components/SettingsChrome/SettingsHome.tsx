"use client";

import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Heading } from "@vimla/ui";
import styles from "./SettingsChrome.module.scss";

export function SettingsHome(): ReactElement {
  const t = useTranslations();
  return (
    <div className={styles.homeDetail} data-testid="settings-empty-detail">
      <Heading as="h1" size="page">
        {t("settings.title")}
      </Heading>
    </div>
  );
}
