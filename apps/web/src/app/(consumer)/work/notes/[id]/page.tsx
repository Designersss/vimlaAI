import type { ReactElement } from "react";
import { WorkShell } from "../../../../../features/shell/WorkShell";
import { WorkNoteEditor } from "../../../../../features/workspace/components/WorkNoteEditor";

export default async function WorkNoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  return (
    <WorkShell>
      <WorkNoteEditor noteId={id} />
    </WorkShell>
  );
}
