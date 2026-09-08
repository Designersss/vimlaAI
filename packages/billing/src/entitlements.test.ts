import { describe, expect, it } from "vitest";
import {
  assertKnownEntitlementKey,
  assertWritableEntitlementKey,
  decodeEntitlement,
  encodeEntitlement,
  isTopupAllowed,
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
});
