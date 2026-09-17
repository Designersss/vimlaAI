import { describe, expect, it } from "vitest";
import { canonicalJson, fingerprintArtifactContent } from "./fingerprint.js";

 describe("artifact fingerprints", () => {
  it("canonicalizes object keys before hashing", () => {
    const left = fingerprintArtifactContent({
      kind: "INLINE_JSON",
      value: { b: 2, a: { y: true, x: [1, "two"] } },
    });
    const right = fingerprintArtifactContent({
      kind: "INLINE_JSON",
      value: { a: { x: [1, "two"], y: true }, b: 2 },
    });
    expect(left).toBe(right);
  });

  it("keeps content references distinct from inline JSON", () => {
    expect(fingerprintArtifactContent({ kind: "CONTENT_REF", ref: "same" })).not.toBe(
      fingerprintArtifactContent({ kind: "INLINE_JSON", value: "same" }),
    );
  });

  it("rejects non-finite JSON numbers", () => {
    expect(() => canonicalJson(Number.POSITIVE_INFINITY as never)).toThrow(/non-finite/i);
  });
});
