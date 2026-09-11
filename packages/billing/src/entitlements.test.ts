import { describe, expect, it } from "vitest";
import {
  assertKnownEntitlementKey,
  assertWritableEntitlementKey,
  decodeEntitlement,
  encodeEntitlement,
  isTopupAllowed,
  projectEntitlementLimits,
} from "./entitlements.js";

describe("entitlements", () => {
  it("rejects unknown keys", () => {
    expect(() => assertKnownEntitlementKey("projects.unknown")).toThrow(/Unknown entitlement key/);
  });

  it("encodes unlimited without a magic number", () => {
    const encoded = encodeEntitlement({ kind: "COUNT", unlimited: true });
    expect(encoded.unlimited).toBe(true);
    expect(encoded.intValue).toBeNull();
  });

  it("allows TBD values for features that are not live yet", () => {
    expect(
      decodeEntitlement({
        key: "storage.maxBytes",
        valueKind: "TBD",
        unlimited: false,
        intValue: null,
        boolValue: null,
      }).value.kind,
    ).toBe("TBD");
  });

  it("rejects deprecated project keys on new drafts", () => {
    expect(() => assertWritableEntitlementKey("projects.max")).toThrow(/Deprecated/);
    expect(assertWritableEntitlementKey("projects.ownedActiveMax")).toBe("projects.ownedActiveMax");
  });

  it("still decodes historical project keys", () => {
    expect(
      decodeEntitlement({
        key: "projects.max",
        valueKind: "COUNT",
        unlimited: false,
        intValue: 1n,
        boolValue: null,
      }).value,
    ).toEqual({ kind: "COUNT", unlimited: false, value: 1n });
  });

  it("defaults top-up allowed when the entitlement is absent", () => {
    expect(isTopupAllowed([])).toBe(true);
    expect(
      isTopupAllowed([{ key: "billing.topupAllowed", value: { kind: "BOOLEAN", value: false } }]),
    ).toBe(false);
  });

  it("uses Free project defaults and treats missing paid keys as unlimited", () => {
    const free = projectEntitlementLimits([], "FREE_FALLBACK");
    expect(free.ownedActiveMax).toEqual({ unlimited: false, value: 1n });
    expect(free.externalActiveMax).toEqual({ unlimited: false, value: 2n });
    expect(free.membersPerOwnedProjectMax).toEqual({ unlimited: false, value: 2n });

    const paidMissing = projectEntitlementLimits([], "SUBSCRIPTION");
    expect(paidMissing.ownedActiveMax.unlimited).toBe(true);
    expect(paidMissing.externalActiveMax.unlimited).toBe(true);
  });

  it("reads canonical project COUNT limits and TBD as unlimited on paid plans", () => {
    const limits = projectEntitlementLimits(
      [
        { key: "projects.ownedActiveMax", value: { kind: "COUNT", unlimited: false, value: 3n } },
        { key: "projects.externalActiveMax", value: { kind: "TBD" } },
        { key: "projects.membersPerOwnedProjectMax", value: { kind: "COUNT", unlimited: true } },
      ],
      "SUBSCRIPTION",
    );
    expect(limits.ownedActiveMax).toEqual({ unlimited: false, value: 3n });
    expect(limits.externalActiveMax.unlimited).toBe(true);
    expect(limits.membersPerOwnedProjectMax.unlimited).toBe(true);
  });
});
