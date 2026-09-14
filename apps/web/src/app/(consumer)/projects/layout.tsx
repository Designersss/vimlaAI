import type { ReactElement, ReactNode } from "react";
import { notFound } from "next/navigation";
import { CONSUMER_FEATURES } from "../../../shared/config/consumer-features";
import { ProjectsRouteShell } from "../../../features/projects/components/ProjectsRouteShell";

export default function ProjectsLayout({ children }: { children: ReactNode }): ReactElement {
  if (!CONSUMER_FEATURES.projects) {
    notFound();
  }
  return <ProjectsRouteShell>{children}</ProjectsRouteShell>;
}
