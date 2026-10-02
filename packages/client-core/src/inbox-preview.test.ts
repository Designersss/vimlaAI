import { describe, expect, it } from "vitest";
import type { InboxItem } from "@vimla/contracts";
import { resolveInboxPreview } from "./inbox-preview.js";

const direct: InboxItem = {
  surfaceId:
    "11111111-1111-4111-8111-111111111111",
  surfaceKind: "DIRECT",
  domainId:
    "22222222-2222-4222-8222-222222222222",
  title: "Peer",
  peer: {
    userId: "peer",
    name: "Peer",
    avatarUrl: null,
  },
  lastActivityAt:
    "2026-10-02T05:00:00.000Z",
  unreadCount: 1,
  preview: {
    kind: "E2EE_LOCAL",
    messageId:
      "33333333-3333-4333-8333-333333333333",
    senderUserId: "peer",
    messageKind: "HUMAN",
    createdAt:
      "2026-10-02T05:00:00.000Z",
  },
  navigationTarget: {
    version: 1,
    kind: "CHAT",
    id: "11111111-1111-4111-8111-111111111111",
  },
};

describe("resolveInboxPreview", () => {
  it("uses server text only for AI threads", () => {
    const ai: InboxItem = {
      surfaceId:
        "44444444-4444-4444-8444-444444444444",
      surfaceKind: "AI_THREAD",
      domainId: "conversation",
      title: "AI",
      peer: null,
      lastActivityAt:
        "2026-10-02T05:00:00.000Z",
      unreadCount: 0,
      preview: {
        kind: "SERVER_TEXT",
        messageId: "message",
        role: "ASSISTANT",
        text: "server preview",
      },
      navigationTarget: {
        version: 1,
        kind: "CHAT",
        id: "44444444-4444-4444-8444-444444444444",
      },
    };
    expect(
      resolveInboxPreview(ai, null),
    ).toBe("server preview");
  });

  it("returns Direct plaintext only when every authoritative metadata field matches", () => {
    const local = {
      conversationId: direct.domainId,
      messageId:
        direct.preview.kind === "E2EE_LOCAL"
          ? direct.preview.messageId
          : "",
      text: "local secret",
      kind: "HUMAN",
      senderUserId: "peer",
      createdAt:
        "2026-10-02T05:00:00.000Z",
    };
    expect(
      resolveInboxPreview(direct, local),
    ).toBe("local secret");
    expect(
      resolveInboxPreview(direct, {
        ...local,
        senderUserId: "attacker",
      }),
    ).toBeNull();
    expect(
      resolveInboxPreview(direct, {
        ...local,
        createdAt:
          "2026-10-02T05:00:01.000Z",
      }),
    ).toBeNull();
    expect(
      resolveInboxPreview(direct, null),
    ).toBeNull();
  });
});
