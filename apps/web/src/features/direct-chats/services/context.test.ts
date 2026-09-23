import { describe, expect, it } from "vitest";
import type { DirectConversationPrivacy } from "@vimla/contracts";
import {
  boundDirectChatContextBefore,
  prepareDirectChatContext,
} from "./context";
import type { StoredPlaintext } from "./crypto-store";

const privacy: DirectConversationPrivacy = {
  shareOwnHistoryWithVimla: true,
  includePeerHistoryWhenInvoking: true,
  peerShareOwnHistoryWithVimla: true,
};

function row(
  index: number,
  senderUserId: string,
  text: string,
): StoredPlaintext {
  return {
    conversationId: "11111111-1111-4111-8111-111111111111",
    messageId: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    text,
    kind: "HUMAN",
    senderUserId,
    createdAt: new Date(Date.UTC(2026, 8, 20, 10, index)).toISOString(),
  };
}

describe("prepareDirectChatContext", () => {
  it("keeps a recent raw tail and retrieves locally relevant older history", () => {
    const messages = [
      row(1, "peer", "old trip decision about Montenegro"),
      ...Array.from({ length: 10 }, (_, index) =>
        row(index + 2, "self", `recent message ${index}`),
      ),
    ];
    const result = prepareDirectChatContext({
      actorUserId: "self",
      privacy,
      query: "what was our Montenegro decision?",
      messages: [...messages].reverse(),
    });

    expect(result.contextBundle.messages).toHaveLength(9);
    expect(
      result.contextBundle.messages.some((message) =>
        message.text.includes("Montenegro"),
      ),
    ).toBe(true);
    expect(result.peerIncluded).toBe(true);
    expect(result.ownIncluded).toBe(true);
  });

  it("fails closed on peer history unless both peer-sharing conditions are true", () => {
    const peer = row(1, "peer", "private peer history");
    const denied = prepareDirectChatContext({
      actorUserId: "self",
      privacy: {
        ...privacy,
        peerShareOwnHistoryWithVimla: false,
      },
      query: "private history",
      messages: [peer],
    });
    expect(denied.contextBundle.messages).toEqual([]);
    expect(denied.peerIncluded).toBe(false);

    const actorDenied = prepareDirectChatContext({
      actorUserId: "self",
      privacy: {
        ...privacy,
        includePeerHistoryWhenInvoking: false,
      },
      query: "private history",
      messages: [peer],
    });
    expect(actorDenied.contextBundle.messages).toEqual([]);
  });

  it("clips same-time and future messages at the encrypted invocation boundary", () => {
    const prepared = prepareDirectChatContext({
      actorUserId: "self",
      privacy,
      query: "history",
      messages: [
        row(1, "self", "old"),
        row(2, "peer", "same"),
        row(3, "peer", "future"),
      ],
    });
    const sourceTime = row(2, "peer", "same").createdAt;
    const bounded = boundDirectChatContextBefore(
      prepared,
      sourceTime,
      "self",
    );
    expect(bounded.contextBundle.messages.map((message) => message.text)).toEqual([
      "old",
    ]);
    expect(bounded.ownIncluded).toBe(true);
    expect(bounded.peerIncluded).toBe(false);
  });

  it("deduplicates message ids and respects aggregate context bounds", () => {
    const oversized = row(1, "self", "x".repeat(5_000));
    const result = prepareDirectChatContext({
      actorUserId: "self",
      privacy,
      query: "anything",
      messages: [oversized, oversized],
    });
    expect(result.contextBundle.messages).toHaveLength(1);
    expect(result.contextBundle.messages[0]?.text.length).toBe(4_000);
  });
});
