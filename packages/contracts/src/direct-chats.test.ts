import { describe, expect, it } from "vitest";
import {
  createDirectConversationSchema,
  markDirectChatReadSchema,
  operatorContextBundleSchema,
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
      createDirectConversationSchema.safeParse({
        peerEmail: "nikita@example.com",
        surfaceId:
          "11111111-1111-4111-8111-111111111111",
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

  it("bounds and validates observed message ids for read advancement", () => {
    const id =
      "11111111-1111-4111-8111-111111111111";
    expect(
      markDirectChatReadSchema.parse({
        seenMessageIds: [id],
      }),
    ).toEqual({
      seenMessageIds: [id],
    });
    expect(
      markDirectChatReadSchema.safeParse({
        seenMessageIds: [id, id],
      }).success,
    ).toBe(false);
    expect(
      markDirectChatReadSchema.safeParse({
        seenMessageIds: ["not-a-uuid"],
      }).success,
    ).toBe(false);
    expect(
      markDirectChatReadSchema.safeParse({
        seenMessageIds: [],
        unreadCount: 0,
      }).success,
    ).toBe(false);
  });

  it("requires concrete message provenance and bounds aggregate E2EE context", () => {
    const message = {
      messageId: "11111111-1111-4111-8111-111111111111",
      senderUserId: "user-a",
      sentAt: "2026-09-23T12:00:00.000Z",
      text: "history",
    };
    expect(
      operatorContextBundleSchema.safeParse({
        messages: [{ ...message, messageId: undefined }],
      }).success,
    ).toBe(false);
    expect(
      operatorContextBundleSchema.safeParse({
        messages: [message, message],
      }).success,
    ).toBe(false);
    expect(
      operatorContextBundleSchema.safeParse({
        messages: Array.from({ length: 9 }, (_, index) => ({
          ...message,
          messageId: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
          text: "x".repeat(4_000),
        })),
      }).success,
    ).toBe(false);
  });
});
