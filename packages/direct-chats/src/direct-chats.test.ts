import { describe, expect, it } from "vitest";
import { resolveDirectChatAssignee } from "./assignee.js";
import { filterOperatorContextBundle } from "./consent.js";
import { directPairKey } from "./pair-key.js";

const alice = { userId: "a", name: "Alice", email: "alice@example.com" };
const nikita = { userId: "n", name: "Nikita", email: "nikita@example.com" };

describe("direct chat identity helpers", () => {
  it("builds a stable pair key and rejects self-chat", () => {
    expect(directPairKey("b", "a")).toBe(directPairKey("a", "b"));
    expect(() => directPairKey("a", "a")).toThrow();
  });

  it("resolves self, peer, and denies a third person", () => {
    expect(resolveDirectChatAssignee(undefined, "a", [alice, nikita])).toEqual({ type: "self" });
    expect(resolveDirectChatAssignee("me", "a", [alice, nikita])).toEqual({ type: "self" });
    expect(resolveDirectChatAssignee("Nikita", "a", [alice, nikita])).toEqual({ type: "peer", userId: "n" });
    expect(resolveDirectChatAssignee("Никите", "a", [{ ...nikita, name: "Никита" }, alice])).toEqual({
      type: "peer",
      userId: "n",
    });
    expect(resolveDirectChatAssignee("Oscar", "a", [alice, nikita])).toEqual({ type: "denied" });
  });

  it("keeps peer history out of @Vimla without both consents", () => {
    const messages = [
      {
        messageId: "11111111-1111-4111-8111-111111111111",
        senderUserId: "a",
        sentAt: "2026-09-11T00:00:00.000Z",
        text: "mine",
      },
      {
        messageId: "22222222-2222-4222-8222-222222222222",
        senderUserId: "n",
        sentAt: "2026-09-11T00:01:00.000Z",
        text: "peer secret",
      },
    ];
    const denied = filterOperatorContextBundle({
      actorUserId: "a",
      memberIds: ["a", "n"],
      consent: {
        actorShareOwnHistoryWithVimla: true,
        actorIncludePeerHistoryWhenInvoking: true,
        peerShareOwnHistoryWithVimla: false,
      },
      messages,
    });
    expect(denied.messages.map((message) => message.text)).toEqual(["mine"]);
    expect(denied.peerDenied).toBe(true);
    expect(denied.peerIncluded).toBe(false);

    const allowed = filterOperatorContextBundle({
      actorUserId: "a",
      memberIds: ["a", "n"],
      consent: {
        actorShareOwnHistoryWithVimla: true,
        actorIncludePeerHistoryWhenInvoking: true,
        peerShareOwnHistoryWithVimla: true,
      },
      messages,
    });
    expect(allowed.peerIncluded).toBe(true);
    expect(allowed.messages).toHaveLength(2);
  });
});
