"use client";

import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Heading } from "@vimla/ui";
import { CONSUMER_FEATURES } from "../../../../shared/config/consumer-features";
import { LocalNavLink } from "../../../shell/ConsumerShell";
import styles from "./SettingsChrome.module.scss";

export function SettingsNavigationPane({ selectedSection }: { selectedSection?: string }): ReactElement {
  const t = useTranslations();

  return (
    <div className={styles.navigationPane} data-testid="settings-navigation-pane">
      <Heading as="h1" size="page">
        {t("settings.title")}
      </Heading>
      <nav className={styles.navigation} aria-label={t("nav.settings")}>
        <LocalNavLink href="/settings/account" active={selectedSection === "account"}>
          {t("nav.account")}
        </LocalNavLink>
        <LocalNavLink href="/settings/security" active={selectedSection === "security"}>
          {t("nav.security")}
        </LocalNavLink>
        <LocalNavLink href="/settings/billing" active={selectedSection === "billing"}>
          {t("nav.billing")}
        </LocalNavLink>
        <LocalNavLink href="/settings/appearance" active={selectedSection === "appearance"}>
          {t("nav.appearance")}
        </LocalNavLink>
        {CONSUMER_FEATURES.notificationsSettings ? (
          <LocalNavLink href="/settings/notifications" active={selectedSection === "notifications"}>
            {t("nav.notifications")}
          </LocalNavLink>
        ) : null}
      </nav>
    </div>
  );
}
