"use client";

import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Heading, SettingsLayout, buttonClassName } from "@vimla/ui";
import { LanguageSwitcher } from "../../../../shared/i18n/LanguageSwitcher";

export function SettingsChrome({ title, children }: { title: string; children: ReactNode }): ReactElement {
  const t = useTranslations();
  const pathname = usePathname();

  function item(href: string, label: string): ReactElement {
    const active = pathname === href;
    return (
      <Link href={href} className={buttonClassName({ variant: active ? "primary" : "ghost", size: "sm" })}>
        {label}
      </Link>
    );
  }

  return (
    <SettingsLayout
      navigation={
        <>
          {item("/settings/security", t("nav.security"))}
          {item("/settings/billing", t("nav.billing"))}
          {item("/settings/appearance", t("nav.appearance"))}
          <Link href="/work" className={buttonClassName({ variant: "ghost", size: "sm" })}>
            {t("nav.work")}
          </Link>
          <Link href="/app" className={buttonClassName({ variant: "ghost", size: "sm" })}>
            {t("nav.chat")}
          </Link>
          <LanguageSwitcher />
        </>
      }
    >
      <Heading as="h1" size="page">
        {title}
      </Heading>
      {children}
    </SettingsLayout>
  );
}
