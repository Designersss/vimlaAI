import { describe, expect, it } from "vitest";
import { cachedDirectPlaintextMatchesMessage } from "./direct-chat-cached-provenance.js";

const original = {
  messageId: "id-1",
  conversationId: "chat-1",
  senderUserId: "alice",
  kind: "HUMAN",
  createdAt: "2026-10-08T14:00:00.000Z",
};

describe("cached Direct plaintext provenance", () => {
  it("accepts only an exact immutable server message identity", () => {
    expect(cachedDirectPlaintextMatchesMessage(original, { ...original })).toBe(true);
    for (const difference of [
      { messageId: "id-2" },
      { conversationId: "chat-2" },
      { senderUserId: "bob" },
      { kind: "OPERATOR_RESPONSE" },
      { createdAt: "2026-10-08T14:00:01.000Z" },
    ]) {
      expect(cachedDirectPlaintextMatchesMessage(original, {
        ...original, ...difference,
      })).toBe(false);
    }
  });
});
