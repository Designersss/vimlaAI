import { describe, expect, it } from "vitest";
import {
  createDirectConversationSchema,
  sendDirectMessageSchema,
  registerCryptoDeviceSchema,
} from "./direct-chats.js";

describe("direct chat contracts", () => {
  it("rejects plaintext, owner fields and extra authority on send", () => {
    expect(
      sendDirectMessageSchema.safeParse({
        clientMessageId: "11111111-1111-4111-8111-111111111111",
        senderDeviceId: "11111111-1111-4111-8111-111111111112",
        kind: "HUMAN",
        content: "hello in plaintext",
        envelopes: [],
      }).success,
    ).toBe(false);

    expect(
      createDirectConversationSchema.safeParse({
        peerEmail: "nikita@example.com",
        userId: "other",
      }).success,
    ).toBe(false);

    expect(
      registerCryptoDeviceSchema.safeParse({
        deviceId: "11111111-1111-4111-8111-111111111111",
        identityEd25519Public: "aaaaaaaaaaaaaaaaaaaaaa==",
        identityX25519Public: "bbbbbbbbbbbbbbbbbbbbbb==",
        signedPrekeyId: 1,
        signedPrekeyPublic: "cccccccccccccccccccccc==",
        signedPrekeySignature: "dddddddddddddddddddddddd==",
        oneTimePrekeys: [{ keyId: 1, publicKey: "eeeeeeeeeeeeeeeeeeeeee==" }],
        identitySecret: "nope",
      }).success,
    ).toBe(false);
  });
});
