"use client";

import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Spinner } from "@vimla/ui";
import styles from "./Work.module.scss";

export function WorkRouteLoading(): ReactElement {
  const t = useTranslations();
  return (
    <div className={styles.routeStatus} role="status">
      <Spinner label={t("work.loading")} />
    </div>
  );
}

export function WorkRouteFailure({ reset }: { reset: () => void }): ReactElement {
  const t = useTranslations();
  return (
    <div className={styles.routeStatus}>
      <ErrorState
        title={t("work.failed")}
        action={<Button onClick={reset}>{t("common.retry")}</Button>}
      />
    </div>
  );
}
