import type { ReactNode } from "react";
import { AdminShell } from "./AdminShell";

export default function Layout({ children }: { children: ReactNode }): ReactNode {
  return <AdminShell>{children}</AdminShell>;
}
