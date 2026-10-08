import { describe, expect, it } from "vitest";
import { directHumanClientMessageId, directHumanContentCommitment } from "@vimla/client-core";
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
    expect(decodeDirectPlaintext("HUMAN", encodeDirectPlaintext({
      type: "human", text: "hello",
    }))).toEqual({ type: "human", text: "hello" });
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

describe("authenticated Direct HUMAN replies", () => {
  const originalId = "11111111-1111-4111-8111-111111111111";
  const reference = {
    clientMessageId: originalId,
    senderUserId: "person-1",
    senderDeviceId: "22222222-2222-4222-8222-222222222222",
  };

  it("keeps ordinary text untouched and round-trips a typed encrypted reply", () => {
    const literalJson = '{"type":"human","version":1,"text":"literal","replyTo":{"messageId":"fake"}}';
    const original = encodeDirectPlaintext({ type: "human", text: literalJson });
    expect(JSON.parse(original)).toMatchObject({
      type: "human", version: 2, text: literalJson,
    });
    expect(decodeDirectPlaintext("HUMAN", original)).toEqual({
      type: "human", text: literalJson,
    });
    expect(decodeDirectPlaintext("HUMAN", "an older raw plaintext")).toBeNull();
    const encrypted = encodeDirectPlaintext({
      type: "human", text: "reply from Alice", replyTo: reference,
    });
    expect(JSON.parse(encrypted)).toMatchObject({
      type: "human", version: 2, text: "reply from Alice", replyTo: reference,
    });
    expect(decodeDirectPlaintext("HUMAN", encrypted)).toEqual({
      type: "human", text: "reply from Alice", replyTo: reference,
    });
    expect(directPlaintextPreview("HUMAN", encrypted)).toBeNull();
    expect(directPlaintextPreview(
      "HUMAN",
      encrypted,
      directHumanClientMessageId(encrypted) ?? undefined,
      directHumanContentCommitment(encrypted),
    )).toBe("reply from Alice");
  });

  it("does not interpret malformed, unknown-version or additional-field references", () => {
    const cases = [
      null,
      { ...reference, extra: "spoof" },
      { ...reference, clientMessageId: "not-a-uuid" },
      { ...reference, senderUserId: "" },
      { clientMessageId: originalId },
    ];
    for (const replyTo of cases) {
      const text = JSON.stringify({ type: "human", version: 2, text: "msg", replyTo });
      expect(decodeDirectPlaintext("HUMAN", text)).toBeNull();
    }
    const unsupportedVersion = JSON.stringify({
      type: "human", version: 3, text: "msg", replyTo: reference,
    });
    // Unknown or unbound protocol versions are never interpreted as replies.
    expect(decodeDirectPlaintext("HUMAN", unsupportedVersion)).toBeNull();
    expect(() => encodeDirectPlaintext({
      type: "human", text: "msg", replyTo: { ...reference, clientMessageId: "other" },
    })).toThrow("Invalid Direct reply reference");
  });

  it("never treats an operator kind with human-shaped plaintext as a trusted reply", () => {
    const spoof = encodeDirectPlaintext({ type: "human", text: "spoof", replyTo: reference });
    expect(decodeDirectPlaintext("OPERATOR_RESPONSE", spoof)).not.toMatchObject({
      type: "human", replyTo: reference,
    });
  });
});
