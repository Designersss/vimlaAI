"use client";

import type { ReactElement, ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";
import { useTranslations } from "next-intl";
import { MasterDetailLayout } from "@vimla/ui";
import { DesktopSectionDock } from "../../../shell/DesktopSectionDock";
import { SettingsNavigationPane } from "./SettingsNavigationPane";
import styles from "./SettingsChrome.module.scss";

export function SettingsRouteShell({ children }: { children: ReactNode }): ReactElement {
  const segment = useSelectedLayoutSegment();
  const t = useTranslations();
  const detailLabel = segment === "account" ? t("nav.account")
    : segment === "security" ? t("nav.security")
    : segment === "billing" ? t("nav.billing")
    : segment === "appearance" ? t("nav.appearance")
    : segment === "notifications" ? t("nav.notifications")
    : t("nav.settings");

  return (
    <div className={styles.workspace} data-testid="settings-shell">
      <MasterDetailLayout
        detailOpen={segment !== null}
        masterLabel={t("nav.settings")}
        detailLabel={detailLabel}
        master={<SettingsNavigationPane selectedSection={segment ?? undefined} />}
        masterFooter={<DesktopSectionDock />}
      >
        {children}
      </MasterDetailLayout>
    </div>
  );
}
