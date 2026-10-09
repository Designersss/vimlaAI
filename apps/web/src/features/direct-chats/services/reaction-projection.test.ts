import { describe, expect, it } from "vitest";
import type { DirectMessageView } from "@vimla/contracts";
import {
  createDirectHumanMessage,
  createDirectReaction,
  decodeDirectHumanPayload,
} from "@vimla/client-core";
import { projectDirectReactions, type ReactionProjectionRow } from "./reaction-projection";
import type { StoredPlaintext } from "./crypto-store";

const conversationId = "11111111-1111-4111-8111-111111111111";
const alice = "alice";
const bob = "bob";
const deviceId = "22222222-2222-4222-8222-222222222222";

function message(
  id: string, clientMessageId: string, commitment: string, kind: "HUMAN" | "REACTION",
  sequence: string, senderUserId = alice, reactionTargetTagB64: string | null = null,
): DirectMessageView {
  return {
    id, clientMessageId, kind, contentCommitmentB64: commitment,
    reactionTargetTagB64,
    conversationId, senderUserId, senderDeviceId: deviceId,
    interactionEpoch: 0, sequence, createdAt: "2026-10-09T09:00:00.000Z",
    envelope: null, mentions: [],
  };
}

function stored(message: DirectMessageView, text: string): StoredPlaintext {
  return {
    conversationId: message.conversationId, messageId: message.id,
    senderUserId: message.senderUserId, senderDeviceId: message.senderDeviceId,
    kind: message.kind, interactionEpoch: message.interactionEpoch,
    clientMessageId: message.clientMessageId,
    contentCommitmentB64: message.contentCommitmentB64,
    reactionTargetTagB64: message.reactionTargetTagB64,
    createdAt: message.createdAt, text,
  };
}

function fixture() {
  const human = createDirectHumanMessage({ type: "human", text: "Hello Alice" });
  const source = message(
    "33333333-3333-4333-8333-333333333333",
    human.clientMessageId, human.contentCommitmentB64, "HUMAN", "1",
  );
  const sourceRow: ReactionProjectionRow = {
    message: source,
    payload: decodeDirectHumanPayload(
      human.plaintext, human.clientMessageId, human.contentCommitmentB64,
    ),
  };
  const prepared = createDirectReaction(
    "add", "❤️", sourceRow, human.plaintext, conversationId,
  );
  const reaction = message(
    "44444444-4444-4444-8444-444444444444",
    prepared.clientMessageId, prepared.contentCommitmentB64,
    "REACTION", "2", bob, prepared.targetTagB64,
  );
  const reactionRow: ReactionProjectionRow = { message: reaction, payload: null };
  const cache = new Map([
    [source.id, stored(source, human.plaintext)],
    [reaction.id, stored(reaction, prepared.plaintext)],
  ]);
  const read = async (id: string): Promise<StoredPlaintext | null> => cache.get(id) ?? null;
  return { sourceRow, reactionRow, cache, read };
}

describe("local authenticated E2EE reaction projection", () => {
  it("projects the decrypted reaction on an authenticated HUMAN original", async () => {
    const f = fixture();
    const result = await projectDirectReactions([f.reactionRow, f.sourceRow], f.read);
    expect(result.eligibleMessageIds.has(f.sourceRow.message.id)).toBe(true);
    expect(result.unavailableMessageIds.size).toBe(0);
    expect(result.states).toMatchObject([
      { active: true, emoji: "❤️", reactorUserId: bob, latestSequence: 2n },
    ]);
  });

  it("fails closed on a signed tag mismatch or undecryptable control event", async () => {
    const f = fixture();
    const row = f.reactionRow.message;
    const cachedReaction = f.cache.get(row.id);
    if (!cachedReaction) throw new Error("Missing fixture");
    f.cache.set(row.id, {
      ...stored(row, cachedReaction.text),
      reactionTargetTagB64: null,
    });
    const unavailable = await projectDirectReactions([f.sourceRow, f.reactionRow], f.read);
    expect(unavailable.states).toEqual([]);
    expect(unavailable.unavailableMessageIds.has(f.sourceRow.message.id)).toBe(true);
    f.cache.delete(row.id);
    const missing = await projectDirectReactions([f.sourceRow, f.reactionRow], f.read);
    expect(missing.unavailableMessageIds.has(f.sourceRow.message.id)).toBe(true);
  });

  it("never projects an unauthenticated source or accidentally turns a reaction into HUMAN text", async () => {
    const f = fixture();
    const fake: ReactionProjectionRow = {
      ...f.sourceRow,
      payload: { type: "human", text: "tampered content" },
    };
    const result = await projectDirectReactions([fake, f.reactionRow], f.read);
    expect(result.states).toEqual([]);
  });
});
