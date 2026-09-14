import type { ReactElement } from "react";
import { WorkShell } from "../../../../features/shell/WorkShell";
import { WorkLists } from "../../../../features/workspace/components/WorkLists";

export default function WorkListsPage(): ReactElement {
  return (
    <WorkShell>
      <WorkLists />
    </WorkShell>
  );
}
