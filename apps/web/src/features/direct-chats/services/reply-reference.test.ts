import { describe, expect, it } from "vitest";
import { directReplyReference, resolveDirectReplySource, type LocalDirectReplySource } from "./reply-reference";

const id = "11111111-1111-4111-8111-111111111111";
const human: LocalDirectReplySource = {
  message: {
    id,
    conversationId: "chat-1",
    senderUserId: "alice",
    kind: "HUMAN",
  },
  payload: { type: "human", text: "original authenticated ciphertext" },
};

describe("Direct quoted-message source verification", () => {
  it("resolves only a decrypted HUMAN with exact id, chat and author", () => {
    const ref = directReplyReference(human);
    expect(resolveDirectReplySource(human, "chat-1", ref)).toBe(human);
    expect(resolveDirectReplySource(undefined, "chat-1", ref)).toBeNull();
    expect(resolveDirectReplySource(human, "chat-2", ref)).toBeNull();
    expect(resolveDirectReplySource(human, "chat-1", { ...ref, senderUserId: "mallory" })).toBeNull();
    expect(resolveDirectReplySource(human, "chat-1", { ...ref, messageId: "22222222-2222-4222-8222-222222222222" })).toBeNull();
  });

  it("does not attribute undecipherable or forged Operator content as a quotation", () => {
    const ref = directReplyReference(human);
    expect(resolveDirectReplySource({ ...human, payload: null }, "chat-1", ref)).toBeNull();
    expect(resolveDirectReplySource({
      ...human, message: { ...human.message, kind: "OPERATOR_RESPONSE" },
    }, "chat-1", ref)).toBeNull();
    expect(resolveDirectReplySource({
      ...human, payload: { type: "invoke", text: "prompt", contextShared: false, peerIncluded: false },
    }, "chat-1", ref)).toBeNull();
  });
});
