"use client";

import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Button, ErrorState } from "@vimla/ui";
import styles from "../../../features/settings/components/SettingsChrome/SettingsChrome.module.scss";

export default function SettingsError({ reset }: { error: Error & { digest?: string }; reset: () => void }): ReactElement {
  const t = useTranslations();
  return (
    <div className={styles.homeDetail}>
      <ErrorState
        title={t("common.genericError")}
        action={<Button onClick={reset}>{t("common.retry")}</Button>}
      />
    </div>
  );
}
