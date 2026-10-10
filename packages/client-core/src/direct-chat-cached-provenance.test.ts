import { describe, expect, it } from "vitest";
import { cachedDirectPlaintextMatchesMessage } from "./direct-chat-cached-provenance.js";

const original = {
  messageId: "id-1",
  conversationId: "chat-1",
  senderUserId: "alice",
  clientMessageId: "44444444-4444-4444-8444-444444444444",
  senderDeviceId: "device-A",
  interactionEpoch: 3,
  kind: "HUMAN",
  createdAt: "2026-10-08T14:00:00.000Z",
};

describe("cached Direct plaintext provenance", () => {
  it("pins an authenticated target tag for decrypted REACTION events", () => {
    const tagged = { ...original, kind: "REACTION",
      contentCommitmentB64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      reactionTargetTagB64: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
    };
    expect(cachedDirectPlaintextMatchesMessage(tagged, tagged)).toBe(true);
    expect(cachedDirectPlaintextMatchesMessage(
      { ...tagged, reactionTargetTagB64: undefined }, tagged,
    )).toBe(false);
    expect(cachedDirectPlaintextMatchesMessage(
      { ...tagged, reactionTargetTagB64: null }, tagged,
    )).toBe(false);
    expect(cachedDirectPlaintextMatchesMessage(
      tagged, { ...tagged, reactionTargetTagB64: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=" },
    )).toBe(false);
  });

  it("accepts only an exact immutable server message identity", () => {
    expect(cachedDirectPlaintextMatchesMessage(original, { ...original })).toBe(true);
    for (const difference of [
      { messageId: "id-2" },
      { conversationId: "chat-2" },
      { senderUserId: "bob" },
      { clientMessageId: "55555555-5555-4555-8555-555555555555" },
      { clientMessageId: undefined },
      { senderDeviceId: "device-B" },
      { senderDeviceId: undefined },
      { interactionEpoch: 4 },
      { interactionEpoch: undefined },
      { kind: "OPERATOR_RESPONSE" },
      { createdAt: "2026-10-08T14:00:01.000Z" },
    ]) {
      expect(cachedDirectPlaintextMatchesMessage(original, {
        ...original, ...difference,
      })).toBe(false);
    }
  });
});
