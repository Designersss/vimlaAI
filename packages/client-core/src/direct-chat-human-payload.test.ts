import { describe, expect, it } from "vitest";
import {
  decryptEnvelope, encryptEnvelope, generateIdentity, generateSignedPreKey,
  initRatchetInitiator, initRatchetResponder, publicBundleFrom,
  utf8, x3dhInitiate, x3dhRespond,
} from "@vimla/e2ee";
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

  it("rejects two DIFFERENT plaintexts signed by the same malicious sender for one id on separate devices", () => {
    const sender = generateIdentity();
    const prepared = createDirectHumanMessage({
      type: "human", text: "authentic visible source",
      replyTo: reference,
    });
    const tampered = JSON.parse(prepared.plaintext) as Record<string, unknown>;
    tampered.text = "different quote shown to second device";
    const bodies = [prepared.plaintext, JSON.stringify(tampered)];
    const verified = bodies.map((plaintext, i) => {
      const recipient = generateIdentity();
      const signed = generateSignedPreKey(recipient, 1);
      const bundle = publicBundleFrom("recipient", recipient, signed, null);
      const init = x3dhInitiate(sender, bundle);
      const sending = initRatchetInitiator(init.sharedKey, init.remoteRatchetPublic);
      const received = x3dhRespond(recipient, signed.secret, null, init.initHeader);
      const opening = initRatchetResponder(received.sharedKey, {
        secret: signed.secret, publicKey: signed.publicKey,
      });
      const ad = {
        conversationId: "00000000-0000-4000-8000-000000000000",
        senderUserId: "11111111-1111-4111-8111-111111111111",
        senderDeviceId: "22222222-2222-4222-8222-222222222222",
        clientMessageId: prepared.clientMessageId,
        recipientDeviceId: i === 0
          ? "33333333-3333-4333-8333-333333333333"
          : "44444444-4444-4444-8444-444444444444",
        kind: "HUMAN" as const,
        interactionEpoch: 0,
      };
      const envelope = encryptEnvelope({
        identity: sender, state: sending,
        plaintext: utf8(plaintext), ad, x3dhInit: init.initHeader,
      });
      // Both ciphertext signatures are completely valid. This verifies that
      // the attack is NOT just an invalid-signature substitution.
      return new TextDecoder().decode(decryptEnvelope({
        senderIdentityEd25519Public: sender.ed25519Public,
        state: opening, envelope, ad,
      }));
    });
    expect(decodeDirectHumanPayload(verified[0]!, prepared.clientMessageId))
      .toEqual({ type: "human", text: "authentic visible source", replyTo: reference });
    expect(decodeDirectHumanPayload(verified[1]!, prepared.clientMessageId))
      .toBeNull();
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
