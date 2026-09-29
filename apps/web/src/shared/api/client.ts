import {
  createAccountClient,
  createChatClient,
  createClientTransport,
  createDirectChatsClient,
  createNotificationsClient,
  createOperatorClient,
} from "@vimla/client-api";
import { publicWebConfig } from "../config/public-env";

export function createWebClientApi(
  fetchImpl: typeof fetch = fetch,
) {
  const transport = createClientTransport({
    baseUrl: publicWebConfig.apiBaseUrl,
    fetchImpl: fetchImpl.bind(globalThis),
    defaultInit: {
      credentials: "include",
      cache: "no-store",
    },
  });

  return {
    account: createAccountClient(transport),
    chat: createChatClient(transport),
    directChats: createDirectChatsClient(transport),
    notifications: createNotificationsClient(transport),
    operator: createOperatorClient(transport),
  };
}
