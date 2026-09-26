import { describe, expect, it } from "vitest";
import type { SerializedRatchetState, X3dhInitHeader } from "@vimla/e2ee";
import {
  RatchetStateConflictError,
  RatchetStateCorruptError,
  canAcquireRatchetLease,
  decodeStoredRatchet,
  assertRatchetVersion,
  markLegacyRatchetOwner,
  storedRatchetRecord,
} from "./ratchet-coordination";

const state: SerializedRatchetState = {
  dhsSecret: "secret",
  dhsPublic: "public",
  dhrPublic: null,
  rootKey: "root",
  sendingChainKey: "send",
  receivingChainKey: null,
  ns: 2,
  nr: 1,
  pn: 0,
  skipped: {},
};

const pendingX3dhInit: X3dhInitHeader = {
  identityEd25519Public: "identity-ed",
  identityX25519Public: "identity-x",
  ephemeralPublic: "ephemeral",
  signedPrekeyId: 1,
  oneTimePrekeyId: 2,
};

describe("ratchet coordination", () => {
  it("requires an owner marker before accepting legacy v2 ratchet state", () => {
    expect(() =>
      decodeStoredRatchet(state, "device-a"),
    ).toThrow(RatchetStateCorruptError);

    const marked = markLegacyRatchetOwner(
      state,
      "device-a",
    );
    expect(
      decodeStoredRatchet(marked, "device-a"),
    ).toEqual({
      stateVersion: 0,
      state,
      pendingX3dhInit: null,
    });
    expect(() =>
      decodeStoredRatchet(marked, "device-b"),
    ).toThrow(RatchetStateCorruptError);
  });

  it("binds versioned ratchet state to the current local device", () => {
    const stored = storedRatchetRecord({
      localDeviceId: "device-a",
      stateVersion: 4,
      state,
      pendingX3dhInit: null,
    });
    expect(decodeStoredRatchet(stored, "device-a")).toEqual({
      stateVersion: 4,
      state,
      pendingX3dhInit: null,
    });
    expect(() => decodeStoredRatchet(stored, "device-b")).toThrow(
      RatchetStateCorruptError,
    );
  });

  it("round-trips a pending first-contact handshake", () => {
    const stored = storedRatchetRecord({
      localDeviceId: "device-a",
      stateVersion: 1,
      state,
      pendingX3dhInit,
    });
    expect(decodeStoredRatchet(stored, "device-a")).toEqual({
      stateVersion: 1,
      state,
      pendingX3dhInit,
    });
  });

  it("rejects a stale compare-and-swap version", () => {
    const current = {
      stateVersion: 5,
      state,
      pendingX3dhInit: null,
    };
    expect(() => assertRatchetVersion(current, 4)).toThrow(
      RatchetStateConflictError,
    );
    expect(() => assertRatchetVersion(current, 5)).not.toThrow();
  });

  it("does not let another owner steal an active lease", () => {
    const lease = {
      owner: "tab-a",
      fence: 3,
      expiresAt: 2_000,
    };
    expect(canAcquireRatchetLease(lease, "tab-b", 1_999)).toBe(false);
    expect(canAcquireRatchetLease(lease, "tab-a", 1_999)).toBe(true);
  });

  it("recovers an expired lease", () => {
    const lease = {
      owner: "crashed-tab",
      fence: 7,
      expiresAt: 2_000,
    };
    expect(canAcquireRatchetLease(lease, "tab-b", 2_000)).toBe(true);
    expect(canAcquireRatchetLease(null, "tab-b", 2_000)).toBe(true);
  });
});
