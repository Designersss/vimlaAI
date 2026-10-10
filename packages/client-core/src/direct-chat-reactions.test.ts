import { describe, expect, it } from "vitest";
import {
  b64ToBytes, bytesToB64, boundReactionEventCommitment,
  boundReactionTargetTag, decryptEnvelope, encryptEnvelope,
  generateIdentity, generateSignedPreKey, initRatchetInitiator,
  initRatchetResponder, publicBundleFrom, reactionClientIdFromCommitment,
  utf8, x3dhInitiate, x3dhRespond,
} from "@vimla/e2ee";
import {
  createDirectHumanMessage,
} from "./direct-chat-human-payload.js";
import type { LocalDirectReplySource } from "./direct-chat-replies.js";
import {
  createDirectReaction,
  decodeDirectReaction,
  directReactionTargetTag,
  resolveDirectReactionSource,
  verifyDirectReaction,
} from "./direct-chat-reactions.js";
import { reduceVerifiedDirectReactions } from "./direct-chat-reaction-state.js";

const conversationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const originalUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const originalDeviceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const reactorUserId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected valid reaction");
  return value;
}

function fixture() {
  const human = createDirectHumanMessage({ type: "human", text: "Original signed source" });
  const source: LocalDirectReplySource = {
    message: {
      kind: "HUMAN",
      conversationId,
      senderUserId: originalUserId,
      senderDeviceId: originalDeviceId,
      clientMessageId: human.clientMessageId,
      contentCommitmentB64: human.contentCommitmentB64,
    },
    payload: { type: "human", text: "Original signed source" },
  };
  return { human, source };
}

function metadata(prepared: ReturnType<typeof createDirectReaction>, sequence = 1n) {
  return {
    kind: "REACTION",
    conversationId,
    senderUserId: reactorUserId,
    clientMessageId: prepared.clientMessageId,
    contentCommitmentB64: prepared.contentCommitmentB64,
    targetTagB64: prepared.targetTagB64,
    sequence,
  };
}

describe("portable Direct reactions crypto and provenance", () => {
  it("roundtrips full-commitment reactions, not a public emoji hash", () => {
    const { human, source } = fixture();
    const add = createDirectReaction("add", "👍", source, human.plaintext, conversationId);
    const another = createDirectReaction("add", "👍", source, human.plaintext, conversationId);
    expect(add.targetTagB64).toBe(another.targetTagB64);
    expect(add.contentCommitmentB64).not.toBe(another.contentCommitmentB64);
    expect(add.clientMessageId).not.toBe(another.clientMessageId);
    expect(add.targetTagB64).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(add.plaintext).not.toBe("👍");
    expect(reactionClientIdFromCommitment(add.contentCommitmentB64)).toBe(add.clientMessageId);
    expect(decodeDirectReaction(
      add.plaintext, add.clientMessageId, add.contentCommitmentB64,
    )).toEqual({
      type: "reaction", action: "add", emoji: "👍",
      target: {
        clientMessageId: human.clientMessageId,
        contentCommitmentB64: human.contentCommitmentB64,
        senderUserId: originalUserId,
        senderDeviceId: originalDeviceId,
      },
    });
    const verified = verifyDirectReaction(
      metadata(add), add.plaintext, source, human.plaintext,
    );
    expect(verified).toMatchObject({
      sequence: 1n, reactorUserId, action: "add", emoji: "👍",
    });
    expect(directReactionTargetTag(
      human.plaintext, required(verified).target, conversationId,
    )).toBe(add.targetTagB64);
  });

  it("scopes stable server-visible tag equality to one authenticated HUMAN source and conversation", () => {
    const { human, source } = fixture();
    const target = {
      clientMessageId: human.clientMessageId,
      contentCommitmentB64: human.contentCommitmentB64,
      senderUserId: originalUserId,
      senderDeviceId: originalDeviceId,
    };
    const knownTag = directReactionTargetTag(human.plaintext, target, conversationId);
    expect(knownTag).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    // Same original yields equal routing tags by DESIGN: the service can
    // link reactions targeting it. The signed event commitment, on the
    // other hand, must remain fresh for each add/remove control.
    const add = createDirectReaction("add", "👍", source, human.plaintext, conversationId);
    const remove = createDirectReaction("remove", "👍", source, human.plaintext, conversationId);
    expect(add.targetTagB64).toBe(knownTag);
    expect(remove.targetTagB64).toBe(knownTag);
    expect(add.contentCommitmentB64).not.toBe(remove.contentCommitmentB64);

    // The SAME plaintext binding secret and canonical source reference
    // cannot be linked by comparing tags across conversations or references.
    expect(directReactionTargetTag(
      human.plaintext, target, "11111111-1111-4111-8111-111111111111",
    )).not.toBe(knownTag);
    expect(directReactionTargetTag(human.plaintext, {
      ...target, senderDeviceId: "33333333-3333-4333-8333-333333333333",
    }, conversationId)).not.toBe(knownTag);

    // Two encrypted HUMAN messages with the same displayed text generate
    // independent source keys/commitments; neither the emoji nor text
    // yields a dictionary-searchable target tag.
    const secondHuman = createDirectHumanMessage({ type: "human", text: "Original signed source" });
    const secondSource = {
      ...source,
      message: {
        ...source.message,
        clientMessageId: secondHuman.clientMessageId,
        contentCommitmentB64: secondHuman.contentCommitmentB64,
      },
    };
    expect(createDirectReaction(
      "add", "👍", secondSource, secondHuman.plaintext, conversationId,
    ).targetTagB64).not.toBe(knownTag);
  });

  it("rejects author, chat, kind, commitment, source and tag substitution", () => {
    const { human, source } = fixture();
    const event = createDirectReaction("add", "❤️", source, human.plaintext, conversationId);
    expect(verifyDirectReaction(
      metadata(event), event.plaintext, source, human.plaintext,
    )).not.toBeNull();
    for (const bad of [
      { ...source, message: { ...source.message, kind: "OPERATOR_RESPONSE" } },
      { ...source, message: { ...source.message, senderUserId: reactorUserId } },
      { ...source, message: { ...source.message, conversationId: "another-chat" } },
      { ...source, message: { ...source.message, contentCommitmentB64: null } },
      { ...source, payload: { type: "human", text: "Forged local text" } },
    ]) {
      expect(verifyDirectReaction(
        metadata(event), event.plaintext, bad, human.plaintext,
      )).toBeNull();
    }
    expect(verifyDirectReaction(
      { ...metadata(event), targetTagB64: createDirectHumanMessage({ type: "human", text: "different" }).contentCommitmentB64 },
      event.plaintext, source, human.plaintext,
    )).toBeNull();
    expect(verifyDirectReaction(
      { ...metadata(event), targetTagB64: null },
      event.plaintext, source, human.plaintext,
    )).toBeNull();
    expect(verifyDirectReaction(
      { ...metadata(event), kind: "HUMAN" },
      event.plaintext, source, human.plaintext,
    )).toBeNull();
    expect(verifyDirectReaction(
      { ...metadata(event), sequence: 0n },
      event.plaintext, source, human.plaintext,
    )).toBeNull();
    const other = createDirectHumanMessage({ type: "human", text: "Different source" });
    expect(resolveDirectReactionSource(
      source, other.plaintext, conversationId, JSON.parse(event.plaintext).target, event.targetTagB64,
    )).toBeNull();
  });

  it("rejects malformed, unknown version, invalid emoji and altered signed identity", () => {
    const { human, source } = fixture();
    const prepared = createDirectReaction("remove", "🔥", source, human.plaintext, conversationId);
    const original = JSON.parse(prepared.plaintext) as Record<string, unknown>;
    const mutated = [
      { action: "clear" },
      { emoji: "dangerous-unbounded-value" },
      { emoji: "a" },
      { emoji: "👍👍" },
      { version: 2 },
      { bindingKey: "" },
      { bindingKey: "A".repeat(44) },
      { target: { ...(original.target as object), contentCommitmentB64: "fake" } },
      { extra: true },
    ];
    for (const item of mutated) {
      expect(decodeDirectReaction(
        JSON.stringify({ ...original, ...item }),
        prepared.clientMessageId, prepared.contentCommitmentB64,
      )).toBeNull();
    }
    expect(decodeDirectReaction(
      " ".repeat(2049), prepared.clientMessageId, prepared.contentCommitmentB64,
    )).toBeNull();
    expect(decodeDirectReaction(
      "not JSON", prepared.clientMessageId, prepared.contentCommitmentB64,
    )).toBeNull();
    expect(decodeDirectReaction(
      prepared.plaintext, crypto.randomUUID(), prepared.contentCommitmentB64,
    )).toBeNull();
    const swapped = b64ToBytes(prepared.contentCommitmentB64);
    swapped[31] = (swapped[31] ?? 0) ^ 1;
    const prefixCollision = bytesToB64(swapped);
    expect(reactionClientIdFromCommitment(prefixCollision)).toBe(prepared.clientMessageId);
    expect(decodeDirectReaction(
      prepared.plaintext, prepared.clientMessageId, prefixCollision,
    )).toBeNull();
    expect(() => createDirectReaction(
      "add", "👍", { ...source, payload: null }, human.plaintext, conversationId,
    )).toThrow("not authenticated");
    expect(() => createDirectReaction(
      "add", "👍", source, human.plaintext, "another-chat",
    )).toThrow("not authenticated");
  });

  it("domain-separates event and opaque lookup HMAC even with same secret/canonical data", () => {
    const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(42)));
    const canonical = '["hello"]';
    const event = boundReactionEventCommitment(key, canonical);
    const target = boundReactionTargetTag(key, canonical);
    expect(event).not.toBe(target);
    expect(boundReactionEventCommitment("", canonical)).toBeNull();
    expect(boundReactionTargetTag("AAA=", canonical)).toBeNull();
  });

  it("rejects sender equivocation despite valid sender signatures on two devices", () => {
    const { human, source } = fixture();
    const prepared = createDirectReaction("add", "😂", source, human.plaintext, conversationId);
    const tampered = JSON.parse(prepared.plaintext) as Record<string, unknown>;
    tampered.action = "remove";
    const sender = generateIdentity();
    const verified = [prepared.plaintext, JSON.stringify(tampered)].map((plaintext, index) => {
      const recipient = generateIdentity();
      const signed = generateSignedPreKey(recipient, 1);
      const init = x3dhInitiate(sender, publicBundleFrom("recipient", recipient, signed, null));
      const send = initRatchetInitiator(init.sharedKey, init.remoteRatchetPublic);
      const shared = x3dhRespond(recipient, signed.secret, null, init.initHeader);
      const receive = initRatchetResponder(shared.sharedKey, {
        secret: signed.secret, publicKey: signed.publicKey,
      });
      const ad = {
        conversationId,
        senderUserId: reactorUserId,
        senderDeviceId: originalDeviceId,
        recipientDeviceId: index === 0
          ? "11111111-1111-4111-8111-111111111111"
          : "22222222-2222-4222-8222-222222222222",
        clientMessageId: prepared.clientMessageId,
        contentCommitmentB64: prepared.contentCommitmentB64,
        kind: "HUMAN" as const, // crypto envelope works before REACTION kind is introduced.
        interactionEpoch: 0,
      };
      const wire = encryptEnvelope({
        identity: sender, state: send, plaintext: utf8(plaintext), ad,
        x3dhInit: init.initHeader,
      });
      return new TextDecoder().decode(decryptEnvelope({
        senderIdentityEd25519Public: sender.ed25519Public,
        state: receive, envelope: wire, ad,
      }));
    });
    expect(decodeDirectReaction(
      required(verified[0]), prepared.clientMessageId, prepared.contentCommitmentB64,
    )?.action).toBe("add");
    expect(decodeDirectReaction(
      required(verified[1]), prepared.clientMessageId, prepared.contentCommitmentB64,
    )).toBeNull();
  });
});

describe("deterministic Direct reaction reducer", () => {
  it("handles unordered add/remove/re-add, duplicates and separate devices", () => {
    const { human, source } = fixture();
    const add = createDirectReaction("add", "👍", source, human.plaintext, conversationId);
    const remove = createDirectReaction("remove", "👍", source, human.plaintext, conversationId);
    const addAgain = createDirectReaction("add", "👍", source, human.plaintext, conversationId);
    const verified = [add, remove, addAgain].map((p, index) =>
      required(verifyDirectReaction(
        metadata(p, BigInt(index + 1)), p.plaintext, source, human.plaintext,
      ))
    );
    expect(reduceVerifiedDirectReactions([
      required(verified[2]), required(verified[0]), required(verified[1]), required(verified[0]),
    ])).toMatchObject([{ active: true, latestSequence: 3n, reactorUserId }]);
    expect(reduceVerifiedDirectReactions([required(verified[1]), required(verified[0])]))
      .toMatchObject([{ active: false, latestSequence: 2n }]);
  });

  it("fails closed on conflicting authoritative sequence or idempotent event id", () => {
    const { human, source } = fixture();
    const a = createDirectReaction("add", "🔥", source, human.plaintext, conversationId);
    const b = createDirectReaction("remove", "🔥", source, human.plaintext, conversationId);
    const va = required(verifyDirectReaction(metadata(a), a.plaintext, source, human.plaintext));
    const vb = required(verifyDirectReaction(metadata(b), b.plaintext, source, human.plaintext));
    expect(() => reduceVerifiedDirectReactions([va, vb])).toThrow("sequence");
    expect(() => reduceVerifiedDirectReactions([
      va, { ...vb, eventClientMessageId: va.eventClientMessageId, sequence: 2n },
    ])).toThrow("replay");
    // Different sender users have independent idempotency namespaces;
    // identical reaction bytes/client IDs must not shadow each other.
    expect(reduceVerifiedDirectReactions([
      va, { ...va, reactorUserId: originalUserId, sequence: 2n },
    ])).toHaveLength(2);
    // Global conversation sequence must NOT be reused, even if the
    // unrelated actor happened to produce the same client message UUID.
    expect(() => reduceVerifiedDirectReactions([
      va, { ...va, reactorUserId: originalUserId, sequence: 1n },
    ])).toThrow("sequence");
  });
});
