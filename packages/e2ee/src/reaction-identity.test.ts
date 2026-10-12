import { describe, expect, it } from "vitest";
import {
  boundReactionEventCommitment,
  boundReactionTargetTag,
  reactionClientIdFromCommitment,
} from "./reaction-identity.js";
import { bytesToB64, utf8 } from "./bytes.js";
import { encryptEnvelope, decryptEnvelope, serializeDirectReactionTargetTag } from "./envelope.js";
import { generateIdentity, generateSignedPreKey, publicBundleFrom } from "./keys.js";
import { initRatchetInitiator, initRatchetResponder } from "./ratchet.js";
import { x3dhInitiate, x3dhRespond } from "./x3dh.js";

describe("Direct reaction event identity and AD5 routing", () => {
  it("domain-separates an opaque source tag from full signed event commitment", () => {
    const key = bytesToB64(new Uint8Array(32).fill(4));
    const canonical = JSON.stringify(["add", "👍", "source"]);
    const commitment = boundReactionEventCommitment(key, canonical);
    const targetTag = boundReactionTargetTag(key, canonical);
    expect(commitment).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(targetTag).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(commitment).not.toBe(targetTag);
    if (!commitment) throw new Error("Expected full commitment");
    expect(reactionClientIdFromCommitment(commitment)).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(boundReactionTargetTag("not base64", canonical)).toBeNull();
    expect(() => serializeDirectReactionTargetTag("bad")).toThrow();
  });

  it("authenticates the opaque source tag, kind and full event commitment for every recipient", () => {
    const sender = generateIdentity();
    const recipient = generateIdentity();
    const prekey = generateSignedPreKey(recipient, 1);
    const init = x3dhInitiate(sender, publicBundleFrom("recipient", recipient, prekey, null));
    const opening = x3dhRespond(recipient, prekey.secret, null, init.initHeader);
    const sendingState = initRatchetInitiator(init.sharedKey, init.remoteRatchetPublic);
    const recipientState = initRatchetResponder(opening.sharedKey, {
      secret: prekey.secret, publicKey: prekey.publicKey,
    });
    const secret = bytesToB64(new Uint8Array(32).fill(9));
    const full = boundReactionEventCommitment(secret, JSON.stringify(["add", "🔥", "target"]));
    const id = full ? reactionClientIdFromCommitment(full) : null;
    const tag = boundReactionTargetTag(secret, "original source");
    if (!full || !id || !tag) throw new Error("Invalid E2EE fixture");
    const ad = {
      conversationId: "11111111-1111-4111-8111-111111111111",
      senderUserId: "sender-user",
      senderDeviceId: "22222222-2222-4222-8222-222222222222",
      clientMessageId: id,
      contentCommitmentB64: full,
      recipientDeviceId: "33333333-3333-4333-8333-333333333333",
      kind: "REACTION" as const,
      interactionEpoch: 0,
      routingContext: serializeDirectReactionTargetTag(tag),
    };
    const text = utf8('{"type":"reaction","action":"add","emoji":"🔥"}');
    const encrypted = encryptEnvelope({
      identity: sender, state: sendingState, plaintext: text, ad, x3dhInit: init.initHeader,
    });
    const changedTag = bytesToB64(new Uint8Array(32).fill(10));
    expect(() => decryptEnvelope({
      senderIdentityEd25519Public: sender.ed25519Public,
      state: recipientState, envelope: encrypted,
      ad: { ...ad, routingContext: serializeDirectReactionTargetTag(changedTag) },
    })).toThrow("Sender signature is invalid");
    expect(() => decryptEnvelope({
      senderIdentityEd25519Public: sender.ed25519Public,
      state: recipientState, envelope: encrypted,
      ad: { ...ad, kind: "HUMAN" },
    })).toThrow("Sender signature is invalid");
    expect(() => decryptEnvelope({
      senderIdentityEd25519Public: sender.ed25519Public,
      state: recipientState, envelope: encrypted,
      ad: { ...ad, contentCommitmentB64: bytesToB64(new Uint8Array(32).fill(11)) },
    })).toThrow("Sender signature is invalid");
    expect(new TextDecoder().decode(decryptEnvelope({
      senderIdentityEd25519Public: sender.ed25519Public,
      state: recipientState, envelope: encrypted, ad,
    }))).toEqual(new TextDecoder().decode(text));
  });
});
