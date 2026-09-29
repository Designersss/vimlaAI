import type {
  ConversationDefaultTarget,
  ConversationDetail,
  ConversationSummary,
} from "@vimla/contracts";
import { createWebClientApi } from "../../../shared/api/client";

export async function fetchConversations(
  fetchImpl: typeof fetch = fetch,
): Promise<ConversationSummary[]> {
  return createWebClientApi(fetchImpl).chat.fetchConversations();
}

export async function createConversation(
  fetchImpl: typeof fetch = fetch,
): Promise<ConversationSummary> {
  return createWebClientApi(fetchImpl).chat.createConversation();
}

export async function fetchConversation(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ConversationDetail> {
  return createWebClientApi(fetchImpl).chat.fetchConversation(id);
}

export async function updateConversationDefaultTarget(
  id: string,
  target: ConversationDefaultTarget,
  fetchImpl: typeof fetch = fetch,
): Promise<ConversationDefaultTarget> {
  return createWebClientApi(fetchImpl).chat.updateConversationDefaultTarget(
    id,
    target,
  );
}
