import { describe, expect, it } from "vitest";
import type { CryptoDeviceView, DirectConversationView } from "@vimla/contracts";
import { directSenderVerificationKeys } from "./index.js";

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

describe("Direct historic sender signature directory", () => {
  it("verifies old revoked senders without placing them in active recipients", () => {
    const live = device("22222222-2222-4222-8222-222222222222");
    const revoked = device("33333333-3333-4333-8333-333333333333", true);
    const detail: Pick<DirectConversationView, "devices" | "historicalSenderIdentities"> = {
      devices: [live],
      historicalSenderIdentities: [{
        deviceId: revoked.id,
        identityEd25519Public: revoked.identityEd25519Public,
      }],
    };
    expect(detail.devices).toHaveLength(1);
    expect(detail.devices.some((candidate) => candidate.id === revoked.id)).toBe(false);
    expect([...directSenderVerificationKeys(detail)]).toEqual([
      [live.id, live.identityEd25519Public],
      [revoked.id, revoked.identityEd25519Public],
    ]);
  });

  it("never treats a claimed X3DH header as a substitute for the device directory", () => {
    const live = device("22222222-2222-4222-8222-222222222222");
    const identities = directSenderVerificationKeys({
      devices: [live],
      historicalSenderIdentities: [],
    });
    expect(identities.get(live.id)).toBe(live.identityEd25519Public);
    expect(identities.get("attacker-device")).toBeUndefined();
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
      }],
    })).toThrow("Conflicting Direct sender identity directory");
    expect(() => directSenderVerificationKeys({
      devices: [live],
      historicalSenderIdentities: [{
        deviceId: "33333333-3333-4333-8333-333333333333",
        identityEd25519Public: "old-sender",
      }, {
        deviceId: "33333333-3333-4333-8333-333333333333",
        identityEd25519Public: "another-old-sender",
      }],
    })).toThrow("Conflicting Direct sender identity directory");
  });
});
