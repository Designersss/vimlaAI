"use client";

import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Spinner } from "@vimla/ui";
import styles from "../../../features/settings/components/SettingsChrome/SettingsChrome.module.scss";

export default function SettingsLoading(): ReactElement {
  const t = useTranslations();
  return (
    <div className={styles.homeDetail}>
      <Spinner label={t("common.loading")} />
    </div>
  );
}
