"use client";

import type { ReactElement, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { NotificationBell } from "../../notifications/components/NotificationBell";
import { ConsumerShell, LocalNavLink } from "../../shell/ConsumerShell";

export function ProjectShell({
  projectId,
  title,
  children,
}: {
  projectId?: string;
  title?: string;
  children: ReactNode;
}): ReactElement {
  const t = useTranslations();
  const pathname = usePathname();
  const localNav = projectId ? (
    <nav aria-label={t("projects.title")}>
      <LocalNavLink href={`/projects/${projectId}`} active={pathname === `/projects/${projectId}`}>
        {t("projects.overview")}
      </LocalNavLink>
      <LocalNavLink href={`/projects/${projectId}`} active={false} disabled>
        {t("projects.chats")}
      </LocalNavLink>
      <LocalNavLink href={`/projects/${projectId}`} active={false} disabled>
        {t("projects.work")}
      </LocalNavLink>
      <LocalNavLink href={`/projects/${projectId}`} active={false} disabled>
        {t("projects.context")}
      </LocalNavLink>
      <LocalNavLink
        href={`/projects/${projectId}/members`}
        active={pathname.startsWith(`/projects/${projectId}/members`)}
      >
        {t("projects.members")}
      </LocalNavLink>
    </nav>
  ) : undefined;

  return (
    <ConsumerShell title={title ?? t("projects.title")} actions={<NotificationBell />} localNav={localNav}>
      <div data-testid="projects-shell">{children}</div>
    </ConsumerShell>
  );
}
