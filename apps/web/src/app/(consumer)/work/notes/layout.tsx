import type { ReactElement, ReactNode } from "react";
import { WorkNotesRouteShell } from "../../../../features/workspace/components/WorkNotesRouteShell";

export default function WorkNotesLayout({ children }: { children: ReactNode }): ReactElement {
  return <WorkNotesRouteShell>{children}</WorkNotesRouteShell>;
}
