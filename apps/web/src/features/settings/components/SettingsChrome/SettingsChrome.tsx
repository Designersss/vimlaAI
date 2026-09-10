"use client";

import type { ReactElement, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Heading } from "@vimla/ui";
import { CONSUMER_FEATURES } from "../../../../shared/config/consumer-features";
import { NotificationBell } from "../../../notifications/components/NotificationBell";
import { ConsumerShell, LocalNavLink } from "../../../shell/ConsumerShell";

export function SettingsChrome({ title, children }: { title: string; children: ReactNode }): ReactElement {
  const t = useTranslations();
  const pathname = usePathname();

  return (
    <ConsumerShell
      title={t("nav.settings")}
      actions={<NotificationBell />}
      localNav={
        <nav aria-label={t("nav.settings")}>
          <LocalNavLink href="/settings/account" active={pathname === "/settings/account"}>
            {t("nav.account")}
          </LocalNavLink>
          <LocalNavLink href="/settings/security" active={pathname === "/settings/security"}>
            {t("nav.security")}
          </LocalNavLink>
          <LocalNavLink href="/settings/billing" active={pathname === "/settings/billing"}>
            {t("nav.billing")}
          </LocalNavLink>
          <LocalNavLink href="/settings/appearance" active={pathname === "/settings/appearance"}>
            {t("nav.appearance")}
          </LocalNavLink>
          {CONSUMER_FEATURES.notificationsSettings ? (
            <LocalNavLink href="/settings/notifications" active={pathname === "/settings/notifications"}>
              {t("nav.notifications")}
            </LocalNavLink>
          ) : null}
        </nav>
      }
    >
      <Heading as="h1" size="page">
        {title}
      </Heading>
      {children}
    </ConsumerShell>
  );
}
