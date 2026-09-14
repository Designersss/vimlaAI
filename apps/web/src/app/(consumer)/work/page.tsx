import type { ReactElement } from "react";
import { WorkShell } from "../../../features/shell/WorkShell";
import { WorkToday } from "../../../features/workspace/components/WorkToday";

export default function WorkTodayPage(): ReactElement {
  return (
    <WorkShell>
      <WorkToday />
    </WorkShell>
  );
}
