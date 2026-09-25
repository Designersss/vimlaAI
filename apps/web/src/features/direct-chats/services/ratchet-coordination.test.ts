import { describe, expect, it } from "vitest";
import type { SerializedRatchetState } from "@vimla/e2ee";
import {
  RatchetStateConflictError,
  canAcquireRatchetLease,
  decodeStoredRatchet,
  assertRatchetVersion,
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

describe("ratchet coordination", () => {
  it("loads legacy v2 ratchet state at version zero for safe migration", () => {
    expect(decodeStoredRatchet(state, "device-a")).toEqual({
      stateVersion: 0,
      state,
    });
  });

  it("binds versioned ratchet state to the current local device", () => {
    const stored = storedRatchetRecord({
      localDeviceId: "device-a",
      stateVersion: 4,
      state,
    });
    expect(decodeStoredRatchet(stored, "device-a")).toEqual({
      stateVersion: 4,
      state,
    });
    expect(decodeStoredRatchet(stored, "device-b")).toBeNull();
  });

  it("rejects a stale compare-and-swap version", () => {
    const current = {
      stateVersion: 5,
      state,
    };
    expect(() => assertRatchetVersion(current, 4)).toThrow(
      RatchetStateConflictError,
    );
    expect(() => assertRatchetVersion(current, 5)).not.toThrow();
  });

  it("does not let another owner steal an active lease", () => {
    const lease = {
      owner: "tab-a",
      expiresAt: 2_000,
    };
    expect(canAcquireRatchetLease(lease, "tab-b", 1_999)).toBe(false);
    expect(canAcquireRatchetLease(lease, "tab-a", 1_999)).toBe(true);
  });

  it("recovers an expired lease", () => {
    const lease = {
      owner: "crashed-tab",
      expiresAt: 2_000,
    };
    expect(canAcquireRatchetLease(lease, "tab-b", 2_000)).toBe(true);
    expect(canAcquireRatchetLease(null, "tab-b", 2_000)).toBe(true);
  });
});
