import type { ReactElement, ReactNode } from "react";
import { ChatWorkspaceProvider } from "../../../features/chat/components/ChatWorkspace/ChatWorkspaceProvider";
import { ChatRouteShell } from "../../../features/chat/components/ChatWorkspace/ChatRouteShell";

export default function AppChatLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <ChatWorkspaceProvider>
      <ChatRouteShell>{children}</ChatRouteShell>
    </ChatWorkspaceProvider>
  );
}
