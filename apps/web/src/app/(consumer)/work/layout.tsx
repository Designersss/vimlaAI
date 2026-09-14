import type { ReactElement, ReactNode } from "react";
import { WorkShell } from "../../../features/shell/WorkShell";

export default function WorkLayout({ children }: { children: ReactNode }): ReactElement {
  return <WorkShell>{children}</WorkShell>;
}
