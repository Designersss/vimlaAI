import {
  cryptoDeviceViewSchema,
  cryptoDevicesResponseSchema,
  directConversationViewSchema,
  directMessageViewSchema,
  directMessagesResponseSchema,
  directMessageSendPreflightSchema,
  prepareDirectMessageSendSchema,
  prekeyBundlesResponseSchema,
  type CreateDirectConversation,
  type CryptoDeviceView,
  type DirectConversationView,
  type DirectMessageView,
  type DirectMessagesResponse,
  type DirectMessageSendPreflight,
  type MarkDirectChatRead,
  type PrepareDirectMessageSend,
  type PrekeyBundlesResponse,
  type RegisterCryptoDevice,
  type SendDirectMessage,
  type UpdateDirectChatPrivacy,
} from "@vimla/contracts";
import {
  ClientApiError,
  jsonRequestInit,
  queryString,
  type ClientTransport,
} from "./transport.js";

export class DirectChatsApiError extends ClientApiError {
  constructor(code: string, status = 0) {
    super(code, status);
    this.name = "DirectChatsApiError";
  }
}

export interface DirectChatRequestOptions {
  signal?: AbortSignal;
}

export function createDirectChatsClient(
  transport: ClientTransport,
) {
  const errorFactory = (code: string, status: number) =>
    new DirectChatsApiError(code, status);

  return {
    fetchDirectConversation(
      id: string,
      options: DirectChatRequestOptions = {},
    ): Promise<DirectConversationView> {
      return transport.request(
        `/v1/direct-chats/${encodeURIComponent(id)}`,
        {
          init: signalInit(options.signal),
          parse: (payload) =>
            directConversationViewSchema.parse(payload),
          errorFactory,
        },
      );
    },

    createDirectConversation(
      input: CreateDirectConversation,
      options: DirectChatRequestOptions = {},
    ): Promise<DirectConversationView> {
      return transport.request("/v1/direct-chats", {
        init: jsonRequestInit("POST", input, options.signal),
        parse: (payload) =>
          directConversationViewSchema.parse(payload),
        errorFactory,
      });
    },

    updateDirectChatPrivacy(
      id: string,
      input: UpdateDirectChatPrivacy,
      options: DirectChatRequestOptions = {},
    ): Promise<DirectConversationView> {
      return transport.request(
        `/v1/direct-chats/${encodeURIComponent(id)}/privacy`,
        {
          init: jsonRequestInit("PATCH", input, options.signal),
          parse: (payload) =>
            directConversationViewSchema.parse(payload),
          errorFactory,
        },
      );
    },

    markDirectChatRead(
      id: string,
      input: MarkDirectChatRead,
      options: DirectChatRequestOptions = {},
    ): Promise<DirectConversationView> {
      return transport.request(
        `/v1/direct-chats/${encodeURIComponent(id)}/read`,
        {
          init: jsonRequestInit(
            "POST",
            input,
            options.signal,
          ),
          parse: (payload) =>
            directConversationViewSchema.parse(payload),
          errorFactory,
        },
      );
    },

    fetchDirectMessages(
      id: string,
      deviceId: string,
      cursor?: string,
      options: DirectChatRequestOptions = {},
    ): Promise<DirectMessagesResponse> {
      const query = queryString([
        ["deviceId", deviceId],
        ["limit", 30],
        ["cursor", cursor],
      ]);
      return transport.request(
        `/v1/direct-chats/${encodeURIComponent(id)}/messages${query}`,
        {
          init: signalInit(options.signal),
          parse: (payload) =>
            directMessagesResponseSchema.parse(payload),
          errorFactory,
        },
      );
    },

    prepareDirectMessageSend(
      id: string,
      input: PrepareDirectMessageSend,
      options: DirectChatRequestOptions = {},
    ): Promise<DirectMessageSendPreflight> {
      const body = prepareDirectMessageSendSchema.parse(input);
      return transport.request(
        `/v1/direct-chats/${encodeURIComponent(id)}/send-preflight`,
        {
          init: jsonRequestInit("POST", body, options.signal),
          parse: (payload) =>
            directMessageSendPreflightSchema.parse(payload),
          errorFactory,
        },
      );
    },

    sendDirectMessage(
      id: string,
      input: SendDirectMessage,
      options: DirectChatRequestOptions = {},
    ): Promise<DirectMessageView> {
      return transport.request(
        `/v1/direct-chats/${encodeURIComponent(id)}/messages`,
        {
          init: jsonRequestInit("POST", input, options.signal),
          parse: (payload) => directMessageViewSchema.parse(payload),
          errorFactory,
        },
      );
    },

    registerCryptoDevice(
      input: RegisterCryptoDevice,
      options: DirectChatRequestOptions = {},
    ): Promise<CryptoDeviceView> {
      return transport.request("/v1/direct-chats/devices", {
        init: jsonRequestInit("POST", input, options.signal),
        parse: (payload) => cryptoDeviceViewSchema.parse(payload),
        errorFactory,
      });
    },

    revokeCryptoDevice(
      deviceId: string,
      options: DirectChatRequestOptions = {},
    ): Promise<CryptoDeviceView> {
      return transport.request(
        `/v1/direct-chats/devices/${encodeURIComponent(deviceId)}/revoke`,
        {
          init: {
            method: "POST",
            ...(options.signal ? { signal: options.signal } : {}),
          },
          parse: (payload) => cryptoDeviceViewSchema.parse(payload),
          errorFactory,
        },
      );
    },

    async fetchMyCryptoDevices(
      options: DirectChatRequestOptions = {},
    ): Promise<CryptoDeviceView[]> {
      const page = await transport.request(
        "/v1/direct-chats/devices",
        {
          init: signalInit(options.signal),
          parse: (payload) =>
            cryptoDevicesResponseSchema.parse(payload),
          errorFactory,
        },
      );
      return page.items;
    },

    fetchPrekeyBundles(
      userId: string,
      options: DirectChatRequestOptions = {},
    ): Promise<PrekeyBundlesResponse> {
      return transport.request(
        `/v1/direct-chats/users/${encodeURIComponent(userId)}/prekeys`,
        {
          init: jsonRequestInit("POST", {}, options.signal),
          parse: (payload) =>
            prekeyBundlesResponseSchema.parse(payload),
          errorFactory,
        },
      );
    },
  };
}

function signalInit(signal: AbortSignal | undefined): RequestInit {
  return signal ? { signal } : {};
}
