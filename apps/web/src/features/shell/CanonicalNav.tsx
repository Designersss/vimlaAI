"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { BriefcaseIcon, MessageSquareIcon, SettingsIcon, buttonClassName } from "@vimla/ui";

export function CanonicalNav(): ReactElement {
  const t = useTranslations();
  const pathname = usePathname();

  return (
    <nav aria-label={t("work.title")}>
      {item("/app", t("nav.chat"), pathname === "/app", <MessageSquareIcon size={16} aria-hidden="true" />)}
      {item("/work", t("nav.work"), pathname === "/work" || pathname.startsWith("/work/"), <BriefcaseIcon size={16} aria-hidden="true" />)}
      {item(
        "/settings/security",
        t("nav.settings"),
        pathname.startsWith("/settings"),
        <SettingsIcon size={16} aria-hidden="true" />,
      )}
    </nav>
  );
}

function item(href: string, label: string, active: boolean, icon: ReactElement): ReactElement {
  return (
    <Link href={href} className={buttonClassName({ variant: active ? "primary" : "ghost", size: "sm" })}>
      {icon}
      {label}
    </Link>
  );
}
