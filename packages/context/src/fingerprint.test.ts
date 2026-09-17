import { describe, expect, it } from "vitest";
import { fingerprintContextItem, fingerprintContextSnapshot } from "./fingerprint.js";

const base = {
  sourceType: "USER_MESSAGE" as const,
  sourceId: "message-1",
  sourceVersion: "v1",
  classification: "PRIVATE" as const,
  contentRef: "message:message-1:v1",
  metadata: { b: 2, a: 1 },
};

describe("context fingerprints", () => {
  it("is stable for equivalent metadata key ordering", () => {
    expect(fingerprintContextItem(base)).toBe(
      fingerprintContextItem({ ...base, metadata: { a: 1, b: 2 } }),
    );
  });

  it("changes when a frozen source version changes", () => {
    expect(fingerprintContextItem(base)).not.toBe(
      fingerprintContextItem({ ...base, sourceVersion: "v2" }),
    );
  });

  it("is order-sensitive at snapshot level", () => {
    const second = { ...base, sourceType: "CONVERSATION" as const, sourceId: "conversation-1" };
    expect(fingerprintContextSnapshot([base, second])).not.toBe(
      fingerprintContextSnapshot([second, base]),
    );
  });
});
