import type { ReactElement } from "react";
import { PublicProfileScreen } from "../../../../../features/people/components/PublicProfileScreen";

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<ReactElement> {
  const { handle } = await params;
  return <PublicProfileScreen handle={handle} />;
}
