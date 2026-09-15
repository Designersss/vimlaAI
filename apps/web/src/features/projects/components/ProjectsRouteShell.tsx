"use client";

import type { ReactElement, ReactNode } from "react";
import { useSelectedLayoutSegments } from "next/navigation";
import { useTranslations } from "next-intl";
import { MasterDetailLayout } from "@vimla/ui";
import { DesktopSectionDock } from "../../shell/DesktopSectionDock";
import { ProjectListPane } from "./ProjectListPane";
import { ProjectsWorkspaceProvider } from "./ProjectsWorkspaceProvider";
import styles from "./Projects.module.scss";

export function ProjectsRouteShell({ children }: { children: ReactNode }): ReactElement {
  const segments = useSelectedLayoutSegments();
  const t = useTranslations();
  const projectId = segments[0];
  const isJoinFlow = projectId === "join";

  if (isJoinFlow) {
    return <>{children}</>;
  }

  return (
    <ProjectsWorkspaceProvider>
      <div className={styles.workspace} data-testid="projects-shell">
        <MasterDetailLayout
          detailOpen={Boolean(projectId)}
          masterLabel={t("projects.title")}
          detailLabel={t("projects.overview")}
          master={<ProjectListPane selectedProjectId={projectId} />}
          masterFooter={<DesktopSectionDock />}
        >
          {children}
        </MasterDetailLayout>
      </div>
    </ProjectsWorkspaceProvider>
  );
}
