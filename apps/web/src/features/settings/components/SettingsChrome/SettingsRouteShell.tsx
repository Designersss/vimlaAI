"use client";

import type { ReactElement, ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";
import { useTranslations } from "next-intl";
import { MasterDetailLayout } from "@vimla/ui";
import { SettingsNavigationPane } from "./SettingsNavigationPane";
import styles from "./SettingsChrome.module.scss";

export function SettingsRouteShell({ children }: { children: ReactNode }): ReactElement {
  const segment = useSelectedLayoutSegment();
  const t = useTranslations();

  return (
    <div className={styles.workspace} data-testid="settings-shell">
      <MasterDetailLayout
        detailOpen={segment !== null}
        masterLabel={t("nav.settings")}
        detailLabel={t("nav.settings")}
        master={<SettingsNavigationPane selectedSection={segment ?? undefined} />}
      >
        {children}
      </MasterDetailLayout>
    </div>
  );
}
