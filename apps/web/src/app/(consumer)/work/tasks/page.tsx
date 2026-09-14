import type { ReactElement } from "react";
import { WorkShell } from "../../../../features/shell/WorkShell";
import { WorkTasks } from "../../../../features/workspace/components/WorkTasks";

export default function WorkTasksPage(): ReactElement {
  return (
    <WorkShell>
      <WorkTasks />
    </WorkShell>
  );
}
