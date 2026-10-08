import { describe, expect, it } from "vitest";
import {
  createDirectHumanMessage,
  decodeDirectHumanPayload,
  directHumanClientMessageId,
  encodeDirectHumanPayload,
} from "./direct-chat-human-payload.js";

const reference = {
  clientMessageId: "11111111-1111-4111-8111-111111111111",
  senderUserId: "sender",
  senderDeviceId: "22222222-2222-4222-8222-222222222222",
};

describe("portable Direct HUMAN E2EE content commitment", () => {
  it("generates a random opaque signed ID bound to EXACT text and reply identity", () => {
    const message = { type: "human" as const, text: "a reply", replyTo: reference };
    const prepared = createDirectHumanMessage(message);
    const other = createDirectHumanMessage(message);
    const wire = JSON.parse(prepared.plaintext) as Record<string, unknown>;
    expect(wire).toMatchObject({ type: "human", version: 2, text: "a reply", replyTo: reference });
    expect(typeof wire.bindingKey).toBe("string");
    expect((wire.bindingKey as string).length).toBe(44);
    expect(prepared.clientMessageId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(prepared.clientMessageId).not.toBe(other.clientMessageId);
    expect(directHumanClientMessageId(prepared.plaintext)).toBe(prepared.clientMessageId);
    expect(decodeDirectHumanPayload(prepared.plaintext, prepared.clientMessageId)).toEqual(message);
    expect(decodeDirectHumanPayload(prepared.plaintext, other.clientMessageId)).toBeNull();
    expect(JSON.stringify(message)).not.toContain(wire.bindingKey as string);
  });

  it("rejects equivocation: different signed ciphertexts for same claimed sender ID", () => {
    const original = createDirectHumanMessage({ type: "human", text: "original" });
    const alternateText = JSON.parse(original.plaintext) as Record<string, unknown>;
    alternateText.text = "malicious alternative on another device";
    const differentBody = JSON.stringify(alternateText);
    expect(decodeDirectHumanPayload(differentBody, original.clientMessageId)).toBeNull();
    expect(directHumanClientMessageId(differentBody)).not.toBe(original.clientMessageId);

    const alternateKey = JSON.parse(original.plaintext) as Record<string, unknown>;
    alternateKey.bindingKey = (JSON.parse(createDirectHumanMessage({
      type: "human", text: "unrelated",
    }).plaintext) as Record<string, unknown>).bindingKey;
    expect(decodeDirectHumanPayload(JSON.stringify(alternateKey), original.clientMessageId)).toBeNull();

    const alternateReply = JSON.parse(original.plaintext) as Record<string, unknown>;
    alternateReply.replyTo = reference;
    expect(decodeDirectHumanPayload(JSON.stringify(alternateReply), original.clientMessageId)).toBeNull();
  });

  it("keeps literal JSON user text distinct from encrypted control metadata", () => {
    const raw = JSON.stringify({ type: "human", version: 2, text: "wrong", replyTo: reference });
    const wire = encodeDirectHumanPayload({ type: "human", text: raw });
    expect(decodeDirectHumanPayload(wire)).toEqual({ type: "human", text: raw });
  });

  it("rejects unsupported, unbound, forged and malformed messages", () => {
    expect(decodeDirectHumanPayload("historical raw text")).toBeNull();
    expect(decodeDirectHumanPayload(JSON.stringify({
      type: "human", version: 1, text: "legacy",
    }))).toBeNull();
    expect(decodeDirectHumanPayload(JSON.stringify({
      type: "human", version: 3, text: "future",
    }))).toBeNull();
    const valid = JSON.parse(encodeDirectHumanPayload({
      type: "human", text: "answer", replyTo: reference,
    })) as Record<string, unknown>;
    for (const mutation of [
      { replyTo: { ...reference, senderUserId: "" } },
      { bindingKey: "" },
      { bindingKey: "AAAA" },
      { bindingKey: "A".repeat(44) },
      { extra: "spoof" },
    ]) {
      expect(decodeDirectHumanPayload(JSON.stringify({ ...valid, ...mutation }))).toBeNull();
    }
    expect(() => encodeDirectHumanPayload({
      type: "human", text: "answer", replyTo: { ...reference, clientMessageId: "not-a-uuid" },
    })).toThrow("Invalid Direct reply reference");
  });
});
