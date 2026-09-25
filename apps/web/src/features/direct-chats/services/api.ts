import {
  apiErrorResponseSchema,
  cryptoDeviceViewSchema,
  cryptoDevicesResponseSchema,
  directConversationViewSchema,
  directConversationsResponseSchema,
  directMessageViewSchema,
  directMessagesResponseSchema,
  prekeyBundlesResponseSchema,
  prekeyStatusResponseSchema,
  type CreateDirectConversation,
  type CryptoDeviceView,
  type DirectConversationView,
  type DirectConversationsResponse,
  type DirectMessageView,
  type DirectMessagesResponse,
  type PrekeyBundlesResponse,
  type PrekeyStatusResponse,
  type RegisterCryptoDevice,
  type ReplenishOneTimePrekeys,
  type SendDirectMessage,
  type UpdateDirectChatPrivacy,
} from "@vimla/contracts";
import { publicWebConfig } from "../../../shared/config/public-env";
import { AuthRequiredError } from "../../auth/services/current-user";

export class DirectChatsApiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "DirectChatsApiError";
  }
}

function jsonHeaders(): HeadersInit {
  return { "content-type": "application/json" };
}

async function request<T>(
  path: string,
  init: RequestInit,
  parse: (payload: unknown) => T,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl(`${publicWebConfig.apiBaseUrl}${path}`, {
    credentials: "include",
    cache: "no-store",
    ...init,
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = apiErrorResponseSchema.safeParse(payload);
    throw new DirectChatsApiError(parsed.success ? parsed.data.error.code : "internal_error");
  }
  return parse(payload);
}

export async function fetchDirectConversations(fetchImpl: typeof fetch = fetch): Promise<DirectConversationsResponse> {
  return request("/v1/direct-chats", {}, (payload) => directConversationsResponseSchema.parse(payload), fetchImpl);
}

export async function fetchDirectConversation(id: string, fetchImpl: typeof fetch = fetch): Promise<DirectConversationView> {
  return request(`/v1/direct-chats/${id}`, {}, (payload) => directConversationViewSchema.parse(payload), fetchImpl);
}

export async function createDirectConversation(
  input: CreateDirectConversation,
  fetchImpl: typeof fetch = fetch,
): Promise<DirectConversationView> {
  return request(
    "/v1/direct-chats",
    { method: "POST", headers: jsonHeaders(), body: JSON.stringify(input) },
    (payload) => directConversationViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function updateDirectChatPrivacy(
  id: string,
  input: UpdateDirectChatPrivacy,
  fetchImpl: typeof fetch = fetch,
): Promise<DirectConversationView> {
  return request(
    `/v1/direct-chats/${id}/privacy`,
    { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify(input) },
    (payload) => directConversationViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function markDirectChatRead(id: string, fetchImpl: typeof fetch = fetch): Promise<DirectConversationView> {
  return request(
    `/v1/direct-chats/${id}/read`,
    { method: "POST", headers: jsonHeaders(), body: "{}" },
    (payload) => directConversationViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function fetchDirectMessages(
  id: string,
  deviceId: string,
  cursor?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DirectMessagesResponse> {
  const params = new URLSearchParams({ deviceId, limit: "30" });
  if (cursor) {
    params.set("cursor", cursor);
  }
  return request(
    `/v1/direct-chats/${id}/messages?${params.toString()}`,
    {},
    (payload) => directMessagesResponseSchema.parse(payload),
    fetchImpl,
  );
}

export async function sendDirectMessage(
  id: string,
  input: SendDirectMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<DirectMessageView> {
  return request(
    `/v1/direct-chats/${id}/messages`,
    { method: "POST", headers: jsonHeaders(), body: JSON.stringify(input) },
    (payload) => directMessageViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function registerCryptoDevice(
  input: RegisterCryptoDevice,
  fetchImpl: typeof fetch = fetch,
): Promise<CryptoDeviceView> {
  return request(
    "/v1/direct-chats/devices",
    { method: "POST", headers: jsonHeaders(), body: JSON.stringify(input) },
    (payload) => cryptoDeviceViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function fetchMyCryptoDevices(fetchImpl: typeof fetch = fetch): Promise<CryptoDeviceView[]> {
  const page = await request(
    "/v1/direct-chats/devices",
    {},
    (payload) => cryptoDevicesResponseSchema.parse(payload),
    fetchImpl,
  );
  return page.items;
}

export async function fetchPrekeyStatus(
  deviceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PrekeyStatusResponse> {
  return request(
    `/v1/direct-chats/devices/${deviceId}/prekeys/status`,
    {},
    (payload) => prekeyStatusResponseSchema.parse(payload),
    fetchImpl,
  );
}

export async function replenishOneTimePrekeys(
  deviceId: string,
  input: ReplenishOneTimePrekeys,
  fetchImpl: typeof fetch = fetch,
): Promise<PrekeyStatusResponse> {
  return request(
    `/v1/direct-chats/devices/${deviceId}/prekeys/replenish`,
    {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(input),
    },
    (payload) => prekeyStatusResponseSchema.parse(payload),
    fetchImpl,
  );
}

export async function fetchPrekeyBundles(userId: string, fetchImpl: typeof fetch = fetch): Promise<PrekeyBundlesResponse> {
  return request(
    `/v1/direct-chats/users/${userId}/prekeys`,
    {},
    (payload) => prekeyBundlesResponseSchema.parse(payload),
    fetchImpl,
  );
}
