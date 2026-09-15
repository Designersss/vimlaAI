"use client";

import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeftIcon, buttonClassName } from "@vimla/ui";
import { LocalNavLink } from "../../shell/ConsumerShell";
import { ConsumerPage } from "../../shell/ConsumerPage";
import styles from "./Projects.module.scss";

export function ProjectShell({
  projectId,
  children,
}: {
  projectId?: string;
  children: ReactNode;
}): ReactElement {
  const t = useTranslations();
  const pathname = usePathname();
  const localNav = projectId ? (
    <>
      <Link
        href="/projects"
        scroll={false}
        aria-label={t("common.back")}
        className={`${buttonClassName({ variant: "ghost", size: "sm" })} ${styles.mobileBack}`}
      >
        <ChevronLeftIcon size={16} aria-hidden="true" />
        {t("common.back")}
      </Link>
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
    </>
  ) : undefined;

  return (
    <ConsumerPage localNav={localNav}>
      <div className={styles.detailRoot} data-testid="project-detail-shell">
        {children}
      </div>
    </ConsumerPage>
  );
}
