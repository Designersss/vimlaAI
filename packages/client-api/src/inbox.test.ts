import { describe, expect, it, vi } from "vitest";
import { inboxResponseSchema } from "@vimla/contracts";
import { createInboxClient } from "./inbox.js";
import { createClientTransport } from "./transport.js";

describe("inbox client", () => {
  it("encodes filters and parses the unified response", async () => {
    const payload = inboxResponseSchema.parse({
      items: [],
      nextCursor: null,
    });
    const fetchImpl = vi.fn(
      async (
        url: string | URL | Request,
      ) => {
        expect(String(url)).toBe(
          "https://api.example.test/v1/inbox?limit=25&kind=DIRECT&q=Nikita",
        );
        return new Response(
          JSON.stringify(payload),
          {
            status: 200,
            headers: {
              "content-type":
                "application/json",
            },
          },
        );
      },
    ) as unknown as typeof fetch;

    const client = createInboxClient(
      createClientTransport({
        baseUrl: "https://api.example.test",
        fetchImpl,
      }),
    );

    await expect(
      client.fetchInbox({
        limit: 25,
        kind: "DIRECT",
        q: "Nikita",
      }),
    ).resolves.toEqual(payload);
  });
});
