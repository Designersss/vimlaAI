import { describe, expect, it } from "vitest";
import type { CryptoDeviceView, DirectConversationView, DirectMessageView } from "@vimla/contracts";
import {
  directSenderVerificationKeys,
  hasConflictingDirectX3dhSenderIdentity,
} from "./index.js";

function device(id: string, revoked = false): CryptoDeviceView {
  return {
    id,
    userId: "11111111-1111-4111-8111-111111111111",
    identityEd25519Public: `ed-${id}`,
    identityX25519Public: `x-${id}`,
    signedPrekeyId: 1,
    signedPrekeyPublic: "signed",
    signedPrekeySignature: "signature",
    createdAt: "2026-10-12T00:00:00.000Z",
    revoked,
  };
}

function message(
  sender: CryptoDeviceView,
  initOverride: Partial<NonNullable<DirectMessageView["envelope"]>["x3dhInit"]> = {},
): DirectMessageView {
  const init = {
    identityEd25519Public: sender.identityEd25519Public,
    identityX25519Public: sender.identityX25519Public,
    ephemeralPublic: "ephemeral",
    signedPrekeyId: 1,
    oneTimePrekeyId: null,
    ...initOverride,
  };
  return {
    id: "44444444-4444-4444-8444-444444444444",
    conversationId: "55555555-5555-4555-8555-555555555555",
    senderUserId: sender.userId,
    senderDeviceId: sender.id,
    clientMessageId: "66666666-6666-4666-8666-666666666666",
    contentCommitmentB64: null,
    reactionTargetTagB64: null,
    sequence: "1",
    kind: "OPERATOR_INVOKE",
    interactionEpoch: 0,
    createdAt: "2026-10-12T00:00:00.000Z",
    mentions: [],
    envelope: {
      recipientDeviceId: "77777777-7777-4777-8777-777777777777",
      headerB64: "wire-header",
      ciphertextB64: "ciphertext",
      dhPublicB64: "dh",
      messageNumber: 0,
      previousChainLength: 0,
      senderSignatureB64: "signature",
      x3dhInit: init,
    },
  };
}

describe("Direct historic sender signature directory", () => {
  it("verifies old revoked senders without placing them in active recipients", () => {
    const live = device("22222222-2222-4222-8222-222222222222");
    const revoked = device("33333333-3333-4333-8333-333333333333", true);
    const detail: Pick<DirectConversationView, "devices" | "historicalSenderIdentities"> = {
      devices: [live],
      historicalSenderIdentities: [{
        deviceId: revoked.id,
        identityEd25519Public: revoked.identityEd25519Public,
        identityX25519Public: revoked.identityX25519Public,
      }],
    };
    expect(detail.devices).toHaveLength(1);
    expect(detail.devices.some((candidate) => candidate.id === revoked.id)).toBe(false);
    expect([...directSenderVerificationKeys(detail)]).toEqual([
      [live.id, {
        identityEd25519Public: live.identityEd25519Public,
        identityX25519Public: live.identityX25519Public,
      }],
      [revoked.id, {
        identityEd25519Public: revoked.identityEd25519Public,
        identityX25519Public: revoked.identityX25519Public,
      }],
    ]);
    expect(hasConflictingDirectX3dhSenderIdentity(
      [message(revoked), message(live)], directSenderVerificationKeys(detail),
    )).toBe(false);
  });

  it("rejects signed X3DH identity substitution before ratchet processing", () => {
    const live = device("22222222-2222-4222-8222-222222222222");
    const revoked = device("33333333-3333-4333-8333-333333333333", true);
    const identities = directSenderVerificationKeys({
      devices: [live],
      historicalSenderIdentities: [{
        deviceId: revoked.id,
        identityEd25519Public: revoked.identityEd25519Public,
        identityX25519Public: revoked.identityX25519Public,
      }],
    });
    for (const sender of [live, revoked]) {
      expect(hasConflictingDirectX3dhSenderIdentity([
        message(sender, { identityX25519Public: "attacker-x-public" }),
      ], identities)).toBe(true);
      expect(hasConflictingDirectX3dhSenderIdentity([
        message(sender, { identityEd25519Public: "attacker-ed-public" }),
      ], identities)).toBe(true);
      expect(hasConflictingDirectX3dhSenderIdentity([
        message(sender),
      ], identities)).toBe(false);
      // An entire page is rejected before a legitimate first envelope
      // can advance the ratchet ahead of a conflicting later envelope.
      expect(hasConflictingDirectX3dhSenderIdentity([
        message(live), message(sender, { identityX25519Public: "wrong" }),
      ], identities)).toBe(true);
    }
    // Old ratchet messages do not repeat X3DH init: the trusted sender
    // directory is still required for their signed AD5 verification.
    const oldRatchetMessage = message(live);
    if (!oldRatchetMessage.envelope) throw new Error("Missing test envelope");
    expect(hasConflictingDirectX3dhSenderIdentity([{
      ...oldRatchetMessage,
      envelope: { ...oldRatchetMessage.envelope, x3dhInit: null },
    }], identities)).toBe(false);
  });

  it("never adopts unknown devices' X3DH identity as its own verification key", () => {
    const live = device("22222222-2222-4222-8222-222222222222");
    const unknown = device("33333333-3333-4333-8333-333333333333");
    const identities = directSenderVerificationKeys({
      devices: [live],
      historicalSenderIdentities: [],
    });
    expect(identities.get(live.id)?.identityEd25519Public).toBe(live.identityEd25519Public);
    expect(identities.get(unknown.id)).toBeUndefined();
    // This checker only catches contradictions against KNOWN keys:
    // an unknown device remains undecryptable without an Ed25519 key.
    expect(hasConflictingDirectX3dhSenderIdentity([message(unknown)], identities)).toBe(false);
  });

  it("rejects duplicate, revoked-as-active, and contradictory identity records", () => {
    const live = device("22222222-2222-4222-8222-222222222222");
    expect(() => directSenderVerificationKeys({
      devices: [live, live],
      historicalSenderIdentities: [],
    })).toThrow("Invalid active Direct sender identity directory");
    expect(() => directSenderVerificationKeys({
      devices: [{ ...live, revoked: true }],
      historicalSenderIdentities: [],
    })).toThrow("Invalid active Direct sender identity directory");
    expect(() => directSenderVerificationKeys({
      devices: [live],
      historicalSenderIdentities: [{
        deviceId: live.id,
        identityEd25519Public: "another-public-key",
        identityX25519Public: "another-public-x",
      }],
    })).toThrow("Conflicting Direct sender identity directory");
    expect(() => directSenderVerificationKeys({
      devices: [live],
      historicalSenderIdentities: [{
        deviceId: "33333333-3333-4333-8333-333333333333",
        identityEd25519Public: "old-sender",
        identityX25519Public: "old-sender-x",
      }, {
        deviceId: "33333333-3333-4333-8333-333333333333",
        identityEd25519Public: "another-old-sender",
        identityX25519Public: "another-old-x",
      }],
    })).toThrow("Conflicting Direct sender identity directory");
  });
});
