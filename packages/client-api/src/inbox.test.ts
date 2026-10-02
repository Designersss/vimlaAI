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
  it("resolves one inbox item by stable surface id", async () => {
    const surfaceId =
      "11111111-1111-4111-8111-111111111111";
    const payload = {
      surfaceId,
      surfaceKind: "AI_THREAD" as const,
      domainId: "conversation",
      title: "AI",
      peer: null,
      lastActivityAt:
        "2026-10-02T05:00:00.000Z",
      unreadCount: 0 as const,
      preview: { kind: "NONE" as const },
      navigationTarget: {
        version: 1 as const,
        kind: "CHAT" as const,
        id: surfaceId,
      },
    };
    const fetchImpl = vi.fn(
      async (
        url: string | URL | Request,
      ) => {
        expect(String(url)).toBe(
          `https://api.example.test/v1/inbox/${surfaceId}`,
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
        baseUrl:
          "https://api.example.test",
        fetchImpl,
      }),
    );
    await expect(
      client.fetchInboxItem(surfaceId),
    ).resolves.toEqual(payload);
  });
});
