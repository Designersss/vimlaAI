import {
  mentionSuggestionsResponseSchema,
  type MentionSuggestionsResponse,
} from "@vimla/contracts";
import { publicWebConfig } from "../../../shared/config/public-env";
import { AuthRequiredError } from "../../auth/services/current-user";

export async function fetchMentionSuggestions(
  input: {
    q: string;
    conversationId?: string;
    projectId?: string;
    directConversationId?: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<MentionSuggestionsResponse> {
  const params = new URLSearchParams();
  if (input.q) params.set("q", input.q);
  if (input.conversationId) params.set("conversationId", input.conversationId);
  if (input.projectId) params.set("projectId", input.projectId);
  if (input.directConversationId) params.set("directConversationId", input.directConversationId);

  const response = await fetchImpl(`${publicWebConfig.apiBaseUrl}/v1/mentions?${params.toString()}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 401) throw new AuthRequiredError();
  if (!response.ok) throw new Error("Unable to load mention suggestions");
  return mentionSuggestionsResponseSchema.parse(await response.json());
}
