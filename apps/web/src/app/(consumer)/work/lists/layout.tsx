import type { ReactElement, ReactNode } from "react";
import { WorkListsRouteShell } from "../../../../features/workspace/components/WorkListsRouteShell";

export default function WorkListsLayout({ children }: { children: ReactNode }): ReactElement {
  return <WorkListsRouteShell>{children}</WorkListsRouteShell>;
}
