import type { ReactElement } from "react";
import { WorkListDetail } from "../../../../../features/workspace/components/WorkListDetail";

export default async function WorkListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  return <WorkListDetail key={id} listId={id} />;
}
