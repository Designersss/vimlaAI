import { describe, expect, it } from "vitest";
import {
  createDirectConversationSchema,
  directConversationViewSchema,
  directMessageViewSchema,
  directParticipantSchema,
  markDirectChatReadSchema,
  operatorContextBundleSchema,
  sendDirectMessageSchema,
  registerCryptoDeviceSchema,
} from "./direct-chats.js";

describe("direct chat contracts", () => {
  it("bounds every server-supplied bigint sequence before client BigInt parsing", () => {
    const messageSequence = directMessageViewSchema.shape.sequence;
    const conversationHead = directConversationViewSchema.shape.lastMessageSequence;
    const valid = ["1", "9007199254740993", "9223372036854775807"];
    const invalid = ["", "00", "01", "-1", "9223372036854775808", "9".repeat(80)];
    for (const value of valid) {
      expect(messageSequence.safeParse(value).success).toBe(true);
      expect(conversationHead.safeParse(value).success).toBe(true);
    }
    expect(conversationHead.safeParse("0").success).toBe(true);
    expect(messageSequence.safeParse("0").success).toBe(false);
    for (const value of invalid) {
      expect(messageSequence.safeParse(value).success).toBe(false);
      expect(conversationHead.safeParse(value).success).toBe(false);
    }
  });

  it("rejects plaintext, email addressing and extra authority on send", () => {
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
      createDirectConversationSchema.parse({
        peerHandle: "Nikita.User",
      }),
    ).toEqual({
      peerHandle: "nikita.user",
    });

    expect(
      createDirectConversationSchema.safeParse({
        peerEmail: "nikita@example.com",
      }).success,
    ).toBe(false);

    expect(
      createDirectConversationSchema.safeParse({
        peerHandle: "nikita.user",
        userId: "other",
      }).success,
    ).toBe(false);

    expect(
      createDirectConversationSchema.safeParse({
        peerHandle: "nikita.user",
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

  it("uses PublicProfile code-point bounds for participant display names", () => {
    const displayName = "🚀".repeat(80);
    expect(
      directParticipantSchema.parse({
        userId: "user-1",
        handle: "nikita.user",
        name: displayName,
        avatarUrl: null,
      }).name,
    ).toBe(displayName);
    expect(
      directParticipantSchema.safeParse({
        userId: "user-1",
        handle: "nikita.user",
        name: "🚀".repeat(81),
        avatarUrl: null,
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
