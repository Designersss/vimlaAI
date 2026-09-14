import type { ReactElement } from "react";
import { WorkNoteEditor } from "../../../../../features/workspace/components/WorkNoteEditor";

export default async function WorkNoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  return <WorkNoteEditor key={id} noteId={id} />;
}
