"use client";

import type { ReactElement } from "react";
import { ChatDetailStatus } from "../../../features/chat/components/ChatWorkspace/ChatDetailStatus";

export default function ChatDetailError({ retry }: { retry: () => void }): ReactElement {
  return <ChatDetailStatus failed retry={retry} />;
}
