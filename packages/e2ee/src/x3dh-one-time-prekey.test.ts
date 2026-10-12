import { describe, expect, it } from "vitest";
import {
  generateIdentity,
  generateOneTimePreKey,
  generateSignedPreKey,
  publicBundleFrom,
} from "./keys.js";
import { x3dhInitiate, x3dhRespond } from "./x3dh.js";

describe("X3DH one-time prekey presence and identity", () => {
  it("derives matching three-DH and four-DH secrets for consistent bundles", () => {
    const initiator = generateIdentity();
    const recipient = generateIdentity();
    const signed = generateSignedPreKey(recipient, 1);
    const otk = generateOneTimePreKey(1);
    for (const oneTime of [null, otk]) {
      const initiated = x3dhInitiate(
        initiator,
        publicBundleFrom("recipient-device", recipient, signed, oneTime),
      );
      const responded = x3dhRespond(
        recipient,
        signed.secret,
        oneTime?.secret ?? null,
        initiated.initHeader,
      );
      expect(responded.sharedKey).toEqual(initiated.sharedKey);
      expect(responded.associatedData).toEqual(initiated.associatedData);
      expect(initiated.initHeader.oneTimePrekeyId).toBe(oneTime?.keyId ?? null);
    }
  });

  it("rejects a supplied one-time public key without its matching key id", () => {
    const initiator = generateIdentity();
    const recipient = generateIdentity();
    const signed = generateSignedPreKey(recipient, 1);
    const otk = generateOneTimePreKey(1);
    const valid = publicBundleFrom("recipient-device", recipient, signed, otk);
    expect(() => x3dhInitiate(initiator, {
      ...valid,
      oneTimePrekeyId: null,
    })).toThrow("Inconsistent X3DH one-time prekey bundle");
    expect(() => x3dhInitiate(initiator, {
      ...valid,
      oneTimePrekeyPublic: null,
    })).toThrow("Inconsistent X3DH one-time prekey bundle");
    expect(() => x3dhInitiate(initiator, {
      ...valid,
      oneTimePrekeyId: 0,
    })).toThrow("Inconsistent X3DH one-time prekey bundle");
  });

  it("rejects a missing or unannounced local one-time secret before derivation", () => {
    const initiator = generateIdentity();
    const recipient = generateIdentity();
    const signed = generateSignedPreKey(recipient, 1);
    const otk = generateOneTimePreKey(1);
    const fourDh = x3dhInitiate(
      initiator,
      publicBundleFrom("recipient-device", recipient, signed, otk),
    );
    expect(() => x3dhRespond(
      recipient, signed.secret, null, fourDh.initHeader,
    )).toThrow("X3DH one-time prekey does not match init header");

    const threeDh = x3dhInitiate(
      initiator,
      publicBundleFrom("recipient-device", recipient, signed, null),
    );
    expect(() => x3dhRespond(
      recipient, signed.secret, otk.secret, threeDh.initHeader,
    )).toThrow("X3DH one-time prekey does not match init header");
    expect(() => x3dhRespond(
      recipient, signed.secret, otk.secret,
      { ...fourDh.initHeader, oneTimePrekeyId: 0 },
    )).toThrow("X3DH one-time prekey does not match init header");
  });
});
