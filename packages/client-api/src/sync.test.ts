import { describe, expect, it, vi } from "vitest";
import {
  SYNC_PROTOCOL_VERSION,
  syncResponseSchema,
} from "@vimla/contracts";
import { createClientTransport } from "./transport.js";
import { createSyncClient } from "./sync.js";

describe("sync client", () => {
  it("requests the negotiated protocol and parses the response", async () => {
    const payload = syncResponseSchema.parse({
      syncProtocolVersion: SYNC_PROTOCOL_VERSION,
      deltas: [],
      nextCursor: "YQ.Yg",
      hasMore: false,
    });
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(
        "https://api.example.test/v1/sync?protocolVersion=1&limit=50",
      );
      return new Response(
        JSON.stringify(payload),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as unknown as typeof fetch;

    const client = createSyncClient(
      createClientTransport({
        baseUrl: "https://api.example.test",
        fetchImpl,
      }),
    );
    await expect(
      client.read({ limit: 50 }),
    ).resolves.toEqual(payload);
  });
});
