import { describe, expect, it } from "vitest";
import {
  claimPrekeyBundlesSchema,
  createDirectConversationSchema,
  operatorContextBundleSchema,
  sendDirectMessageSchema,
  registerCryptoDeviceSchema,
  prekeyBundleSchema,
  prekeyStatusResponseSchema,
  replenishOneTimePrekeysSchema,
  rotatePrekeysSchema,
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

  it("rejects duplicate one-time prekey ids across device payloads", () => {
    const duplicatePrekeys = [
      {
        keyId: 1,
        publicKey: "eeeeeeeeeeeeeeeeeeeeee==",
      },
      {
        keyId: 1,
        publicKey: "ffffffffffffffffffffff==",
      },
    ];
    expect(
      registerCryptoDeviceSchema.safeParse({
        deviceId: "11111111-1111-4111-8111-111111111111",
        identityEd25519Public: "aaaaaaaaaaaaaaaaaaaaaa==",
        identityX25519Public: "bbbbbbbbbbbbbbbbbbbbbb==",
        signedPrekeyId: 1,
        signedPrekeyPublic: "cccccccccccccccccccccc==",
        signedPrekeySignature: "dddddddddddddddddddddddd==",
        oneTimePrekeys: duplicatePrekeys,
      }).success,
    ).toBe(false);
    expect(
      rotatePrekeysSchema.safeParse({
        signedPrekeyId: 2,
        signedPrekeyPublic: "cccccccccccccccccccccc==",
        signedPrekeySignature: "dddddddddddddddddddddddd==",
        oneTimePrekeys: duplicatePrekeys,
      }).success,
    ).toBe(false);
    expect(
      replenishOneTimePrekeysSchema.safeParse({
        oneTimePrekeys: duplicatePrekeys,
      }).success,
    ).toBe(false);
  });

  it("requires device-scoped prekey claims and bounded owner status", () => {
    expect(
      claimPrekeyBundlesSchema.safeParse({}).success,
    ).toBe(false);
    expect(
      claimPrekeyBundlesSchema.safeParse({
        deviceId:
          "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(true);

    expect(
      prekeyStatusResponseSchema.safeParse({
        deviceId:
          "11111111-1111-4111-8111-111111111111",
        available: 1,
        availableKeyIds: [1],
        recentlyConsumedKeyIds: [2, 3],
      }).success,
    ).toBe(true);
    expect(
      prekeyBundleSchema.safeParse({
        deviceId:
          "11111111-1111-4111-8111-111111111111",
        identityEd25519Public:
          "aaaaaaaaaaaaaaaaaaaaaa==",
        identityX25519Public:
          "bbbbbbbbbbbbbbbbbbbbbb==",
        signedPrekeyId: 1,
        signedPrekeyPublic:
          "cccccccccccccccccccccc==",
        signedPrekeySignature:
          "dddddddddddddddddddddddd==",
        oneTimePrekeyId: null,
        oneTimePrekeyPublic: null,
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
