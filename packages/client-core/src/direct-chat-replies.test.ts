import { describe, expect, it } from "vitest";
import {
  directReplyReference,
  readDirectReplyReference,
  resolveDirectReplySource,
  type LocalDirectReplySource,
} from "./direct-chat-replies.js";

const id = "11111111-1111-4111-8111-111111111111";
const human: LocalDirectReplySource = {
  message: {
    clientMessageId: id,
    conversationId: "chat-1",
    senderUserId: "alice",
    senderDeviceId: "22222222-2222-4222-8222-222222222222",
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
    expect(resolveDirectReplySource(human, "chat-1", { ...ref, clientMessageId: "33333333-3333-4333-8333-333333333333" })).toBeNull();
  });

  it("does not attribute undecryptable, malformed or forged Operator content as a quotation", () => {
    const ref = directReplyReference(human);
    expect(resolveDirectReplySource({ ...human, payload: { type: "human" } }, "chat-1", ref)).toBeNull();
    expect(resolveDirectReplySource({ ...human, payload: null }, "chat-1", ref)).toBeNull();
    expect(resolveDirectReplySource({
      ...human, message: { ...human.message, kind: "OPERATOR_RESPONSE" },
    }, "chat-1", ref)).toBeNull();
    expect(resolveDirectReplySource({
      ...human, payload: { type: "invoke", text: "prompt", contextShared: false, peerIncluded: false },
    }, "chat-1", ref)).toBeNull();
  });
});

describe("encrypted Direct reply reference parser", () => {
  const valid = {
    clientMessageId: "11111111-1111-4111-8111-111111111111",
    senderUserId: "alice",
    senderDeviceId: "22222222-2222-4222-8222-222222222222",
  };
  it("accepts exact source identities and rejects malicious extras/invalid IDs", () => {
    expect(readDirectReplyReference(valid)).toEqual(valid);
    expect(readDirectReplyReference({ ...valid, extra: "spoof" })).toBeNull();
    expect(readDirectReplyReference({ ...valid, clientMessageId: "bad" })).toBeNull();
    expect(readDirectReplyReference({ ...valid, senderUserId: "" })).toBeNull();
    expect(readDirectReplyReference({ ...valid, senderDeviceId: "fake-device" })).toBeNull();
    expect(resolveDirectReplySource({
      ...human, message: { ...human.message, senderDeviceId: "33333333-3333-4333-8333-333333333333" },
    }, "chat-1", valid)).toBeNull();
    expect(readDirectReplyReference(null)).toBeNull();
  });
});
