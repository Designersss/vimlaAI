"use client";

import type { ReactElement } from "react";
import { ChatDetailStatus } from "../../../features/chat/components/ChatWorkspace/ChatDetailStatus";

export default function ChatDetailError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactElement {
  return <ChatDetailStatus failed retry={reset} />;
}
