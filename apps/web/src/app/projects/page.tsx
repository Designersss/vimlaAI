import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { CONSUMER_FEATURES } from "../../shared/config/consumer-features";
import { ProjectsHome } from "../../features/projects/components/ProjectsHome";

export default function ProjectsPage(): ReactElement {
  if (!CONSUMER_FEATURES.projects) {
    notFound();
  }
  return <ProjectsHome />;
}
