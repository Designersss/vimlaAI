import {
  aiModelsResponseSchema,
  conversationCreatedSchema,
  conversationDefaultTargetSchema,
  conversationDetailSchema,
  conversationsResponseSchema,
  mentionSuggestionsResponseSchema,
  type ConversationDefaultTarget,
  type ConversationDetail,
  type ConversationSummary,
  type MentionSuggestionsResponse,
  type RetailAiModel,
} from "@vimla/contracts";
import {
  jsonRequestInit,
  queryString,
  type ClientTransport,
} from "./transport.js";

export function createChatClient(transport: ClientTransport) {
  return {
    async fetchConversations(): Promise<ConversationSummary[]> {
      const page = await transport.request("/v1/conversations", {
        parse: (payload) => conversationsResponseSchema.parse(payload),
      });
      return page.conversations;
    },

    createConversation(): Promise<ConversationSummary> {
      return transport.request("/v1/conversations", {
        init: jsonRequestInit("POST", {}),
        parse: (payload) => conversationCreatedSchema.parse(payload),
      });
    },

    fetchConversation(id: string): Promise<ConversationDetail> {
      return transport.request(
        `/v1/conversations/${encodeURIComponent(id)}`,
        {
          parse: (payload) => conversationDetailSchema.parse(payload),
        },
      );
    },

    updateConversationDefaultTarget(
      id: string,
      target: ConversationDefaultTarget,
    ): Promise<ConversationDefaultTarget> {
      return transport.request(
        `/v1/conversations/${encodeURIComponent(id)}/default-target`,
        {
          init: jsonRequestInit("POST", target),
          parse: (payload) =>
            conversationDefaultTargetSchema.parse(payload),
        },
      );
    },

    async fetchAiModels(): Promise<RetailAiModel[]> {
      const page = await transport.request("/v1/ai/models", {
        parse: (payload) => aiModelsResponseSchema.parse(payload),
      });
      return page.models;
    },

    fetchMentionSuggestions(input: {
      q: string;
      conversationId?: string;
      projectId?: string;
      directConversationId?: string;
    }): Promise<MentionSuggestionsResponse> {
      return transport.request(
        `/v1/mentions${queryString([
          ["q", input.q],
          ["conversationId", input.conversationId],
          ["projectId", input.projectId],
          ["directConversationId", input.directConversationId],
        ])}`,
        {
          parse: (payload) =>
            mentionSuggestionsResponseSchema.parse(payload),
        },
      );
    },
  };
}
