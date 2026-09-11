import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { CONSUMER_FEATURES } from "../../../../shared/config/consumer-features";
import { DirectChatWorkspace } from "../../../../features/direct-chats/components/DirectChatWorkspace";

export default async function DirectChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  if (!CONSUMER_FEATURES.directChats) {
    notFound();
  }
  const { id } = await params;
  return <DirectChatWorkspace conversationId={id} />;
}
