import type { ReactElement, ReactNode } from "react";
import { ConsumerShell } from "../../features/shell/ConsumerShell";

export default function ConsumerLayout({ children }: { children: ReactNode }): ReactElement {
  return <ConsumerShell>{children}</ConsumerShell>;
}
