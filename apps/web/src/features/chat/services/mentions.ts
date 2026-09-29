import type { MentionSuggestionsResponse } from "@vimla/contracts";
import { createWebClientApi } from "../../../shared/api/client";

export async function fetchMentionSuggestions(
  input: {
    q: string;
    conversationId?: string;
    projectId?: string;
    directConversationId?: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<MentionSuggestionsResponse> {
  return createWebClientApi(fetchImpl).chat.fetchMentionSuggestions(input);
}
