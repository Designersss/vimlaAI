import type { ReactElement } from "react";
import { ChatDetailStatus } from "../../../features/chat/components/ChatWorkspace/ChatDetailStatus";

export default function ChatNotFound(): ReactElement {
  return <ChatDetailStatus failed />;
}
