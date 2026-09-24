import {
  conversationCreatedSchema,
  conversationDefaultTargetSchema,
  conversationDetailSchema,
  conversationsResponseSchema,
  type ConversationDefaultTarget,
  type ConversationDetail,
  type ConversationSummary,
} from "@vimla/contracts";
import { publicWebConfig } from "../../../shared/config/public-env";
import { AuthRequiredError } from "../../auth/services/current-user";

function headers(): HeadersInit {
  return { "content-type": "application/json" };
}

export async function fetchConversations(
  fetchImpl: typeof fetch = fetch,
): Promise<ConversationSummary[]> {
  const response = await fetchImpl(`${publicWebConfig.apiBaseUrl}/v1/conversations`, {
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) {
    throw new Error("Unable to load conversations");
  }
  return conversationsResponseSchema.parse(await response.json()).conversations;
}

export async function createConversation(
  fetchImpl: typeof fetch = fetch,
): Promise<ConversationSummary> {
  const response = await fetchImpl(`${publicWebConfig.apiBaseUrl}/v1/conversations`, {
    method: "POST",
    credentials: "include",
    headers: headers(),
    body: JSON.stringify({}),
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) {
    throw new Error("Unable to create a conversation");
  }
  return conversationCreatedSchema.parse(await response.json());
}

export async function fetchConversation(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ConversationDetail> {
  const response = await fetchImpl(`${publicWebConfig.apiBaseUrl}/v1/conversations/${id}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) {
    throw new Error("Unable to load the conversation");
  }
  return conversationDetailSchema.parse(await response.json());
}


export async function updateConversationDefaultTarget(
  id: string,
  target: ConversationDefaultTarget,
  fetchImpl: typeof fetch = fetch,
): Promise<ConversationDefaultTarget> {
  const response = await fetchImpl(
    `${publicWebConfig.apiBaseUrl}/v1/conversations/${id}/default-target`,
    {
      method: "POST",
      credentials: "include",
      headers: headers(),
      body: JSON.stringify(target),
    },
  );
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) {
    throw new Error("Unable to update the conversation target");
  }
  return conversationDefaultTargetSchema.parse(await response.json());
}
