import { describe, expect, it } from "vitest";
import {
  INBOX_LIMITS,
  inboxItemSchema,
  inboxResponseSchema,
  listInboxQuerySchema,
} from "./inbox.js";

const surfaceId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";

describe("inbox contracts", () => {
  it("accepts AI server previews and Direct local-only preview descriptors", () => {
    expect(
      inboxItemSchema.parse({
        surfaceId,
        surfaceKind: "AI_THREAD",
        domainId: "cm123",
        title: "Planning",
        peer: null,
        lastActivityAt: "2026-10-02T04:00:00.000Z",
        unreadCount: 0,
        preview: {
          kind: "SERVER_TEXT",
          messageId: "msg-1",
          role: "ASSISTANT",
          text: "Ready",
        },
        navigationTarget: {
          version: 1,
          kind: "CHAT",
          id: surfaceId,
        },
      }),
    ).toMatchObject({ surfaceKind: "AI_THREAD" });

    expect(
      inboxItemSchema.parse({
        surfaceId,
        surfaceKind: "DIRECT",
        domainId: "33333333-3333-4333-8333-333333333333",
        title: "Nikita",
        peer: {
          userId: "peer",
          name: "Nikita",
          avatarUrl: null,
        },
        lastActivityAt: "2026-10-02T04:01:00.000Z",
        unreadCount: 2,
        preview: {
          kind: "E2EE_LOCAL",
          messageId,
          senderUserId: "peer",
          messageKind: "HUMAN",
          createdAt: "2026-10-02T04:01:00.000Z",
        },
        navigationTarget: {
          version: 1,
          kind: "CHAT",
          id: surfaceId,
        },
      }),
    ).toMatchObject({ surfaceKind: "DIRECT" });
  });

  it("rejects server plaintext on Direct surfaces and E2EE-local descriptors on AI threads", () => {
    expect(() =>
      inboxItemSchema.parse({
        surfaceId,
        surfaceKind: "DIRECT",
        domainId: "33333333-3333-4333-8333-333333333333",
        title: "Peer",
        peer: { userId: "peer", name: "Peer", avatarUrl: null },
        lastActivityAt: "2026-10-02T04:01:00.000Z",
        unreadCount: 0,
        preview: {
          kind: "SERVER_TEXT",
          messageId: "secret",
          role: "USER",
          text: "must never cross the server boundary",
        },
        navigationTarget: { version: 1, kind: "CHAT", id: surfaceId },
      }),
    ).toThrow();

    expect(() =>
      inboxItemSchema.parse({
        surfaceId,
        surfaceKind: "AI_THREAD",
        domainId: "cm123",
        title: null,
        peer: null,
        lastActivityAt: "2026-10-02T04:01:00.000Z",
        unreadCount: 0,
        preview: {
          kind: "E2EE_LOCAL",
          messageId,
          senderUserId: "peer",
          messageKind: "HUMAN",
          createdAt: "2026-10-02T04:01:00.000Z",
        },
        navigationTarget: { version: 1, kind: "CHAT", id: surfaceId },
      }),
    ).toThrow();
  });

  it("keeps query and response shapes bounded and strict", () => {
    expect(listInboxQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(
      listInboxQuerySchema.parse({
        limit: "20",
        kind: "DIRECT",
        q: "Nikita",
      }),
    ).toEqual({ limit: 20, kind: "DIRECT", q: "Nikita" });
    expect(() => listInboxQuerySchema.parse({ limit: 101 })).toThrow();
    expect(() => listInboxQuerySchema.parse({ unknown: "x" })).toThrow();

    expect(
      inboxResponseSchema.parse({ items: [], nextCursor: null }),
    ).toEqual({ items: [], nextCursor: null });
    expect(() =>
      inboxResponseSchema.parse({
        items: [],
        nextCursor: "x".repeat(
          INBOX_LIMITS.cursorMax + 1,
        ),
      }),
    ).toThrow();
  });
});
