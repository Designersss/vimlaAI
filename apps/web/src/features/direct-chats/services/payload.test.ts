import { describe, expect, it } from "vitest";
import {
  decodeDirectPlaintext,
  directPlaintextPreview,
  encodeDirectPlaintext,
} from "./payload";

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

  it("projects structured encrypted payloads without exposing internal JSON metadata", () => {
    const invoke = encodeDirectPlaintext({
      type: "invoke",
      text: "summarize this",
      contextShared: true,
      peerIncluded: false,
    });
    const response = encodeDirectPlaintext({
      type: "response",
      text: "Done",
      runId: "internal-run-id",
      clarificationQuestion: null,
    });
    const clarification = encodeDirectPlaintext({
      type: "response",
      text: "",
      runId: "internal-run-id",
      clarificationQuestion: "Which project?",
    });
    const action = encodeDirectPlaintext({
      type: "action",
      title: "Create reminder",
      detail: "Tomorrow",
      status: "success",
    });

    expect(
      directPlaintextPreview(
        "OPERATOR_INVOKE",
        invoke,
      ),
    ).toBe("summarize this");
    expect(
      directPlaintextPreview(
        "OPERATOR_RESPONSE",
        response,
      ),
    ).toBe("Done");
    expect(
      directPlaintextPreview(
        "OPERATOR_RESPONSE",
        clarification,
      ),
    ).toBe("Which project?");
    expect(
      directPlaintextPreview(
        "OPERATOR_ACTION",
        action,
      ),
    ).toBe("Create reminder");
    expect(
      directPlaintextPreview(
        "OPERATOR_RESPONSE",
        '{"type":"response","text":"visible","runId":123}',
      ),
    ).toBeNull();
  });
});
