import { describe, expect, it } from "vitest";
import { decodeDirectHumanPayload, encodeDirectHumanPayload } from "./direct-chat-human-payload.js";

const reference = {
  clientMessageId: "11111111-1111-4111-8111-111111111111",
  senderUserId: "sender",
  senderDeviceId: "22222222-2222-4222-8222-222222222222",
};

describe("portable Direct HUMAN E2EE payload", () => {
  it("preserves literal JSON text without misinterpreting it as a reply", () => {
    const raw = JSON.stringify({ type: "human", version: 1, text: "wrong", replyTo: reference });
    const wire = encodeDirectHumanPayload({ type: "human", text: raw });
    expect(decodeDirectHumanPayload(wire)).toEqual({ type: "human", text: raw });
  });

  it("round-trips authenticated reply references and old raw text", () => {
    const reply = { type: "human" as const, text: "answer", replyTo: reference };
    expect(decodeDirectHumanPayload(encodeDirectHumanPayload(reply))).toEqual(reply);
    expect(decodeDirectHumanPayload("historical raw text")).toEqual({
      type: "human", text: "historical raw text",
    });
  });

  it("rejects forged and unsupported references without quote attribution", () => {
    expect(decodeDirectHumanPayload(JSON.stringify({
      type: "human", version: 1, text: "answer", replyTo: { ...reference, senderUserId: "" },
    }))).toEqual({ type: "human", text: "answer" });
    const unknown = JSON.stringify({
      type: "human", version: 2, text: "future", replyTo: reference,
    });
    expect(decodeDirectHumanPayload(unknown)).toEqual({ type: "human", text: unknown });
    expect(() => encodeDirectHumanPayload({
      type: "human", text: "answer", replyTo: { ...reference, clientMessageId: "not-a-uuid" },
    })).toThrow("Invalid Direct reply reference");
  });
});
