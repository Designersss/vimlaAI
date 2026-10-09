import { describe, expect, it } from "vitest";
import type { DirectMessageView } from "@vimla/contracts";
import {
  createDirectHumanMessage,
  createDirectReaction,
  decodeDirectHumanPayload,
  projectVerifiedDirectReactions,
  type ReactionProjectionRow,
  type CachedDirectReactionPlaintext,
} from "./index.js";

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

function stored(message: DirectMessageView, text: string): CachedDirectReactionPlaintext {
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
  const read = async (id: string): Promise<CachedDirectReactionPlaintext | null> => cache.get(id) ?? null;
  return { sourceRow, reactionRow, cache, read };
}

describe("local authenticated E2EE reaction projection", () => {
  it("projects the decrypted reaction on an authenticated HUMAN original", async () => {
    const f = fixture();
    const result = await projectVerifiedDirectReactions([f.reactionRow, f.sourceRow], f.read, "2");
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
    const unavailable = await projectVerifiedDirectReactions([f.sourceRow, f.reactionRow], f.read, "2");
    expect(unavailable.states).toEqual([]);
    expect(unavailable.unavailableMessageIds.has(f.sourceRow.message.id)).toBe(true);
    f.cache.delete(row.id);
    const missing = await projectVerifiedDirectReactions([f.sourceRow, f.reactionRow], f.read, "2");
    expect(missing.unavailableMessageIds.has(f.sourceRow.message.id)).toBe(true);
  });

  it("uses authoritative sequence to converge add/remove despite reversed pages and duplicates", async () => {
    const f = fixture();
    const original = f.cache.get(f.sourceRow.message.id);
    if (!original) throw new Error("Missing source");
    const removed = createDirectReaction(
      "remove", "❤️", f.sourceRow, original.text, conversationId,
    );
    const messageRow = message(
      "55555555-5555-4555-8555-555555555555",
      removed.clientMessageId, removed.contentCommitmentB64,
      "REACTION", "3", bob, removed.targetTagB64,
    );
    const removal: ReactionProjectionRow = { message: messageRow, payload: null };
    f.cache.set(messageRow.id, stored(messageRow, removed.plaintext));
    const projection = await projectVerifiedDirectReactions(
      [removal, f.sourceRow, f.reactionRow, removal], f.read, "3",
    );
    expect(projection.unavailableMessageIds.size).toBe(0);
    expect(projection.states).toMatchObject([
      { reactorUserId: bob, emoji: "❤️", active: false, latestSequence: 3n },
    ]);
  });

  it("does not allow malformed sequence metadata or missing sources to create reaction state", async () => {
    const f = fixture();
    const invalid = await projectVerifiedDirectReactions([
      f.sourceRow,
      { ...f.reactionRow, message: { ...f.reactionRow.message, sequence: "bad" } },
    ], f.read, "2");
    expect(invalid.states).toEqual([]);
    expect(invalid.eligibleMessageIds.has(f.sourceRow.message.id)).toBe(false);
    const noSource = await projectVerifiedDirectReactions([f.reactionRow], f.read, "2");
    expect(noSource.states).toEqual([]);
    expect(noSource.eligibleMessageIds.size).toBe(0);
  });

  it("hides stale reaction counts until the entire event interval is replayed", async () => {
    const f = fixture();
    const omittedLatest = await projectVerifiedDirectReactions(
      [f.sourceRow, f.reactionRow], f.read, "3",
    );
    expect(omittedLatest.states).toEqual([]);
    expect(omittedLatest.eligibleMessageIds.size).toBe(0);

    const full = await projectVerifiedDirectReactions(
      [f.sourceRow, f.reactionRow], f.read, "2",
    );
    expect(full.states).toMatchObject([{ active: true, latestSequence: 2n }]);
    const tamperedHead = await projectVerifiedDirectReactions(
      [f.sourceRow, f.reactionRow], f.read, "not-a-sequence",
    );
    expect(tamperedHead.eligibleMessageIds.size).toBe(0);
  });

  it("hides incomplete internal history gaps instead of displaying false zero", async () => {
    const f = fixture();
    const newer = {
      ...f.reactionRow,
      message: { ...f.reactionRow.message, id: "77777777-7777-4777-8777-777777777777", sequence: "4" },
    };
    const projection = await projectVerifiedDirectReactions(
      [f.sourceRow, f.reactionRow, newer], f.read, "4",
    );
    expect(projection.states).toEqual([]);
    expect(projection.eligibleMessageIds.size).toBe(0);
  });

  it("reads protected history in bounded parallel batches without changing authenticated state", async () => {
    const f = fixture();
    const additional = Array.from({ length: 25 }, (_, index): ReactionProjectionRow => ({
      message: {
        ...f.sourceRow.message,
        id: `message-${index}`,
        sequence: String(index + 3),
      },
      payload: { type: "human", text: "cached history not present" },
    }));
    let active = 0;
    let peak = 0;
    const accessed: string[] = [];
    const guardedRead = async (id: string): Promise<CachedDirectReactionPlaintext | null> => {
      active += 1;
      peak = Math.max(peak, active);
      accessed.push(id);
      await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
      active -= 1;
      return f.read(id);
    };
    const projection = await projectVerifiedDirectReactions(
      [...additional, f.reactionRow, f.sourceRow],
      guardedRead,
      "27",
    );
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
    expect(accessed).toHaveLength(27);
    expect(projection.states).toMatchObject([
      { active: true, emoji: "❤️", reactorUserId: bob, latestSequence: 2n },
    ]);
    expect(projection.unavailableMessageIds.size).toBe(0);
  });

  it("rejects server-id equivocation before projecting any authenticated count", async () => {
    const f = fixture();
    const conflicting = {
      ...f.reactionRow,
      message: {
        ...f.reactionRow.message,
        reactionTargetTagB64: "forged-reaction-routing-hint",
      },
    };
    const projection = await projectVerifiedDirectReactions(
      [f.reactionRow, f.sourceRow, conflicting],
      f.read,
      "2",
    );
    expect(projection.states).toEqual([]);
    expect(projection.eligibleMessageIds.size).toBe(0);
  });

  it("permits replay of identical server IDs without double counting reactions", async () => {
    const f = fixture();
    const projection = await projectVerifiedDirectReactions(
      [f.sourceRow, f.reactionRow, f.sourceRow, f.reactionRow],
      f.read,
      "2",
    );
    expect(projection.states).toMatchObject([
      { active: true, emoji: "❤️", reactorUserId: bob },
    ]);
    expect(projection.unavailableMessageIds.size).toBe(0);
  });

  it("rejects a protected cache read failure rather than projecting partial counts", async () => {
    const f = fixture();
    await expect(projectVerifiedDirectReactions(
      [f.sourceRow, f.reactionRow],
      async (id) => {
        if (id === f.reactionRow.message.id) throw new Error("Local protection unavailable");
        return f.read(id);
      },
      "2",
    )).rejects.toThrow("Local protection unavailable");
  });

  it("never projects an unauthenticated source or accidentally turns a reaction into HUMAN text", async () => {
    const f = fixture();
    const fake: ReactionProjectionRow = {
      ...f.sourceRow,
      payload: { type: "human", text: "tampered content" },
    };
    const result = await projectVerifiedDirectReactions([fake, f.reactionRow], f.read, "2");
    expect(result.states).toEqual([]);
  });
});
