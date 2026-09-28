import { describe, expect, it } from "vitest";
import { decodeDirectPlaintext, encodeDirectPlaintext } from "./payload";

describe("direct chat plaintext payloads", () => {
  it("keeps operator clarification in the encrypted response payload", () => {
    const response = encodeDirectPlaintext({
      type: "response",
      text: "Нужно уточнение.",
      runId: "11111111-1111-4111-8111-111111111111",
      clarificationQuestion: "Какого именно Никиту вы имеете в виду?",
    });
    expect(
      decodeDirectPlaintext(
        "OPERATOR_RESPONSE",
        response,
      ),
    ).toEqual({
      type: "response",
      text: "Нужно уточнение.",
      runId: "11111111-1111-4111-8111-111111111111",
      clarificationQuestion:
        "Какого именно Никиту вы имеете в виду?",
    });
  });

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
