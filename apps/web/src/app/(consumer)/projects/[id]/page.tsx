import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { CONSUMER_FEATURES } from "../../../../shared/config/consumer-features";
import { ProjectOverview } from "../../../../features/projects/components/ProjectOverview";

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  if (!CONSUMER_FEATURES.projects) {
    notFound();
  }
  const { id } = await params;
  return <ProjectOverview projectId={id} />;
}
