"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckSquareIcon, FolderIcon, MessageSquareIcon, SettingsIcon, VimlaMark } from "@vimla/ui";
import { CONSUMER_FEATURES } from "../../shared/config/consumer-features";
import styles from "./DesktopSectionDock.module.scss";

export function DesktopSectionDock(): ReactElement {
  const pathname = usePathname();
  const t = useTranslations();

  const items = [
    {
      href: "/app",
      label: t("nav.messages"),
      active: pathname === "/app" || pathname.startsWith("/app/"),
      icon: <MessageSquareIcon size={18} aria-hidden="true" />,
    },
    ...(CONSUMER_FEATURES.projects
      ? [{
          href: "/projects",
          label: t("nav.projects"),
          active: pathname === "/projects" || pathname.startsWith("/projects/"),
          icon: <FolderIcon size={18} aria-hidden="true" />,
        }]
      : []),
    {
      href: "/work",
      label: t("nav.workShort"),
      active: pathname === "/work" || pathname.startsWith("/work/"),
      icon: <CheckSquareIcon size={18} aria-hidden="true" />,
    },
    ...(CONSUMER_FEATURES.vimlaOperator
      ? [{
          href: "/vimla",
          label: t("nav.vimla"),
          active: pathname === "/vimla" || pathname.startsWith("/vimla/"),
          icon: <VimlaMark size={18} />,
        }]
      : []),
    {
      href: "/settings/account",
      label: t("nav.settings"),
      active: pathname === "/settings" || pathname.startsWith("/settings/"),
      icon: <SettingsIcon size={18} aria-hidden="true" />,
    },
  ];

  return (
    <nav className={styles.dock} aria-label={t("nav.primary")} data-testid="desktop-section-dock">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-label={item.label}
          title={item.label}
          aria-current={item.active ? "page" : undefined}
          className={`${styles.item} ${item.active ? styles.itemActive : ""}`}
        >
          {item.icon}
        </Link>
      ))}
    </nav>
  );
}
