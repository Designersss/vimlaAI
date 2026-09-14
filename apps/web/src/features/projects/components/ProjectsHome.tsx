"use client";

import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@vimla/ui";
import styles from "./Projects.module.scss";

export function ProjectsHome(): ReactElement {
  const t = useTranslations();
  return (
    <div className={styles.emptyDetail} data-testid="projects-empty-detail">
      <EmptyState title={t("projects.title")} />
    </div>
  );
}
