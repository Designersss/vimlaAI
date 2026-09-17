import { publicWebConfig } from "../../../shared/config/public-env";

export interface DirectChatRealtimeEvent {
  type: "direct_message";
  conversationId: string;
  messageId: string;
  senderUserId: string;
  kind: "HUMAN" | "OPERATOR_INVOKE" | "OPERATOR_RESPONSE" | "OPERATOR_ACTION";
  createdAt: string;
}

export function subscribeDirectChatEvents(input: {
  onMessage: (event: DirectChatRealtimeEvent) => void;
  onOpen?: () => void;
}): () => void {
  const source = new EventSource(`${publicWebConfig.apiBaseUrl}/v1/direct-chats/events`, {
    withCredentials: true,
  });
  source.onopen = () => input.onOpen?.();
  source.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as DirectChatRealtimeEvent;
      if (event.type === "direct_message") input.onMessage(event);
    } catch {
      // The next realtime event or reconnect sync repairs a malformed/transient frame.
    }
  };
  return () => source.close();
}
