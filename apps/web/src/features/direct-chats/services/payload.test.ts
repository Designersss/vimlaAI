import { describe, expect, it } from "vitest";
import { decodeDirectPlaintext, encodeDirectPlaintext } from "./payload";

describe("direct chat plaintext payloads", () => {
  it("keeps human text as ciphertext payload and marks @Vimla kinds", () => {
    expect(encodeDirectPlaintext({ type: "human", text: "hello" })).toBe("hello");
    const invoke = encodeDirectPlaintext({
      type: "invoke",
      text: "who won",
      contextShared: true,
      peerIncluded: false,
    });
    expect(invoke).not.toContain("userId");
    expect(decodeDirectPlaintext("OPERATOR_INVOKE", invoke)).toEqual({
      type: "invoke",
      text: "who won",
      contextShared: true,
      peerIncluded: false,
    });
  });
});
