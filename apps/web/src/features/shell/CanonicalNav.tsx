"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BriefcaseIcon,
  CheckSquareIcon,
  FolderIcon,
  MessageSquareIcon,
  SettingsIcon,
  VimlaMark,
  mobileNavItemClassName,
  sidebarItemClassName,
} from "@vimla/ui";
import { CONSUMER_FEATURES } from "../../shared/config/consumer-features";

export function CanonicalNav({ compact = false }: { compact?: boolean }): ReactElement {
  const t = useTranslations();
  const pathname = usePathname();
  const messagesActive = pathname === "/app" || pathname.startsWith("/app/");
  const workActive = pathname === "/work" || pathname.startsWith("/work/");
  const settingsActive = pathname.startsWith("/settings");

  const items = [
    {
      href: "/app",
      label: t("nav.messages"),
      active: messagesActive,
      icon: compact ? <MessageSquareIcon size={18} aria-hidden="true" /> : <MessageSquareIcon size={16} aria-hidden="true" />,
    },
    {
      href: "/work",
      label: compact ? t("nav.workShort") : t("nav.work"),
      active: workActive,
      icon: compact ? <CheckSquareIcon size={18} aria-hidden="true" /> : <BriefcaseIcon size={16} aria-hidden="true" />,
    },
  ];

  if (CONSUMER_FEATURES.projects) {
    items.push({
      href: "/projects",
      label: t("nav.projects"),
      active: pathname.startsWith("/projects"),
      icon: <FolderIcon size={compact ? 18 : 16} aria-hidden="true" />,
    });
  }

  if (CONSUMER_FEATURES.vimlaOperator) {
    items.push({
      href: "/vimla",
      label: t("nav.vimla"),
      active: pathname.startsWith("/vimla"),
      icon: <VimlaMark size={compact ? 18 : 16} />,
    });
  }

  if (!compact) {
    items.push({
      href: "/settings/account",
      label: t("nav.settings"),
      active: settingsActive,
      icon: <SettingsIcon size={16} aria-hidden="true" />,
    });
  }

  if (compact) {
    return (
      <>
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            className={mobileNavItemClassName({
              active: item.active,
              brand: item.href === "/vimla",
            })}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        ))}
      </>
    );
  }

  return (
    <>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={sidebarItemClassName({
            active: item.active,
            brand: item.href === "/vimla",
          })}
        >
          {item.icon}
          <span>{item.label}</span>
        </Link>
      ))}
    </>
  );
}
