import {
  inboxItemSchema,
  inboxResponseSchema,
  type CommunicationSurfaceKind,
  type InboxItem,
  type InboxResponse,
} from "@vimla/contracts";
import {
  queryString,
  type ClientTransport,
} from "./transport.js";

export interface InboxRequest {
  limit?: number;
  cursor?: string;
  kind?: CommunicationSurfaceKind;
  q?: string;
}

export function createInboxClient(
  transport: ClientTransport,
) {
  return {
    fetchInboxItem(
      surfaceId: string,
    ): Promise<InboxItem> {
      return transport.request(
        `/v1/inbox/${encodeURIComponent(surfaceId)}`,
        {
          parse: (payload) =>
            inboxItemSchema.parse(payload),
        },
      );
    },

    fetchInbox(
      input: InboxRequest = {},
    ): Promise<InboxResponse> {
      return transport.request(
        `/v1/inbox${queryString([
          ["limit", input.limit],
          ["cursor", input.cursor],
          ["kind", input.kind],
          ["q", input.q],
        ])}`,
        {
          parse: (payload) =>
            inboxResponseSchema.parse(payload),
        },
      );
    },
  };
}
