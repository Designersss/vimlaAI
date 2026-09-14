import type { ReactElement } from "react";
import { WorkShell } from "../../../../features/shell/WorkShell";
import { WorkNotes } from "../../../../features/workspace/components/WorkNotes";

export default function WorkNotesPage(): ReactElement {
  return (
    <WorkShell>
      <WorkNotes />
    </WorkShell>
  );
}
