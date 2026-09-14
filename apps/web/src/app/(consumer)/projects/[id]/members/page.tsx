import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { CONSUMER_FEATURES } from "../../../../../shared/config/consumer-features";
import { ProjectMembers } from "../../../../../features/projects/components/ProjectMembers";

export default async function ProjectMembersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  if (!CONSUMER_FEATURES.projects) {
    notFound();
  }
  const { id } = await params;
  return <ProjectMembers projectId={id} />;
}
