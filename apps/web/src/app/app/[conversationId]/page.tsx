import type { ReactElement } from "react";
import { ConversationWorkspace } from "../../../features/chat/components/ChatWorkspace/ConversationWorkspace";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}): Promise<ReactElement> {
  const { conversationId } = await params;
  return <ConversationWorkspace conversationId={conversationId} />;
}
