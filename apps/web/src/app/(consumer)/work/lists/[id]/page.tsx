import type { ReactElement } from "react";
import { WorkShell } from "../../../../../features/shell/WorkShell";
import { WorkListDetail } from "../../../../../features/workspace/components/WorkListDetail";

export default async function WorkListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  return (
    <WorkShell>
      <WorkListDetail listId={id} />
    </WorkShell>
  );
}
