import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { CONSUMER_FEATURES } from "../../../shared/config/consumer-features";
import { ProjectJoin } from "../../../features/projects/components/ProjectJoin";

export default async function ProjectJoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<ReactElement> {
  if (!CONSUMER_FEATURES.projects) {
    notFound();
  }
  const query = await searchParams;
  return <ProjectJoin token={query.token ?? null} />;
}
