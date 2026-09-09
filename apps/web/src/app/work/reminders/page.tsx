import type { ReactElement } from "react";
import { WorkShell } from "../../../features/shell/WorkShell";
import { WorkReminders } from "../../../features/workspace/components/WorkReminders";

export default function WorkRemindersPage(): ReactElement {
  return (
    <WorkShell>
      <WorkReminders />
    </WorkShell>
  );
}
