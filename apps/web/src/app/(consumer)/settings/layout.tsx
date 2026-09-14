import type { ReactElement, ReactNode } from "react";
import { SettingsRouteShell } from "../../../features/settings/components/SettingsChrome/SettingsRouteShell";

export default function SettingsLayout({ children }: { children: ReactNode }): ReactElement {
  return <SettingsRouteShell>{children}</SettingsRouteShell>;
}
