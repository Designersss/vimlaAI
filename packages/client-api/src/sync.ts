import {
  SYNC_PROTOCOL_VERSION,
  syncCursorSchema,
  syncResponseSchema,
  type SyncResponse,
} from "@vimla/contracts";
import {
  queryString,
  type ClientTransport,
} from "./transport.js";

export interface SyncRequestOptions {
  cursor?: string;
  limit?: number;
}

export function createSyncClient(
  transport: ClientTransport,
) {
  return {
    read(
      options: SyncRequestOptions = {},
    ): Promise<SyncResponse> {
      const cursor =
        options.cursor === undefined
          ? undefined
          : syncCursorSchema.parse(
              options.cursor,
            );
      const query = queryString([
        [
          "protocolVersion",
          SYNC_PROTOCOL_VERSION,
        ],
        ["cursor", cursor],
        ["limit", options.limit],
      ]);
      return transport.request(
        `/v1/sync${query}`,
        {
          parse: (payload) =>
            syncResponseSchema.parse(payload),
        },
      );
    },
  };
}
