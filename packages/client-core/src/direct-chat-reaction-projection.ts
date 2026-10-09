import type { DirectMessageView } from "@vimla/contracts";
import {
  cachedDirectPlaintextMatchesMessage,
  type CachedDirectPlaintextProvenance,
} from "./direct-chat-cached-provenance.js";
import { decodeDirectHumanPayload, type HumanPayload } from "./direct-chat-human-payload.js";
import { type DirectReplyReference } from "./direct-chat-replies.js";
import { reduceVerifiedDirectReactions, type DirectReactionState } from "./direct-chat-reaction-state.js";
import {
  directReactionTargetTag,
  verifyDirectReaction,
  type VerifiedDirectReaction,
} from "./direct-chat-reactions.js";

/** Platform-neutral shape of a locally protected, ratchet-verified plaintext. */
export interface CachedDirectReactionPlaintext extends CachedDirectPlaintextProvenance {
  text: string;
}

export interface ReactionProjectionRow {
  message: DirectMessageView;
  payload: HumanPayload | null;
}

export interface DirectReactionsProjection {
  states: DirectReactionState[];
  eligibleMessageIds: ReadonlySet<string>;
  unavailableMessageIds: ReadonlySet<string>;
}

function cachedMatches(
  cached: CachedDirectReactionPlaintext | null,
  message: DirectMessageView,
): cached is CachedDirectReactionPlaintext {
  return cached !== null && cachedDirectPlaintextMatchesMessage(cached, {
    messageId: message.id,
    conversationId: message.conversationId,
    senderUserId: message.senderUserId,
    clientMessageId: message.clientMessageId,
    contentCommitmentB64: message.contentCommitmentB64,
    reactionTargetTagB64: message.reactionTargetTagB64,
    senderDeviceId: message.senderDeviceId,
    interactionEpoch: message.interactionEpoch,
    kind: message.kind,
    createdAt: message.createdAt,
  });
}

function reference(message: DirectMessageView): DirectReplyReference {
  return {
    clientMessageId: message.clientMessageId,
    contentCommitmentB64: message.contentCommitmentB64 ?? "",
    senderUserId: message.senderUserId,
    senderDeviceId: message.senderDeviceId,
  };
}

const MAX_CONCURRENT_PROTECTED_READS = 8;

/**
 * IndexedDB and native secure stores are local, potentially expensive
 * resources. Read a page in bounded parallel batches, not one individual
 * crypto-store transaction per sequential event and not an unbounded
 * Promise.all over the lifetime of a chat.
 *
 * Only a verified cache row is usable below; batching does not change
 * provenance, signature or fail-closed requirements. Any read rejection
 * rejects the projection and hides the entire derived UI state.
 */
async function readCachedPlaintexts(
  ids: readonly string[],
  read: (messageId: string) => Promise<CachedDirectReactionPlaintext | null>,
): Promise<Map<string, CachedDirectReactionPlaintext | null>> {
  const cached = new Map<string, CachedDirectReactionPlaintext | null>();
  const unique = [...new Set(ids)];
  for (let offset = 0; offset < unique.length; offset += MAX_CONCURRENT_PROTECTED_READS) {
    const chunk = unique.slice(offset, offset + MAX_CONCURRENT_PROTECTED_READS);
    const resolved = await Promise.all(
      chunk.map(async (id) => [id, await read(id)] as const),
    );
    for (const [id, value] of resolved) cached.set(id, value);
  }
  return cached;
}

/**
 * Platform-independent E2EE reaction projection, with cache access injected
 * by Web/Desktop/Mobile. All rows must form a contiguous, causally ordered
 * head-to-original interval. Signatures and local cache protection must be
 * checked by the caller BEFORE admitting a stored plaintext.
 * The head watermark is PostgreSQL's inclusive lastMessageSequence; a
 * missing newer event invalidates all visible aggregates until repaired.
 *
 * A tag is only a correlation hint: no unverified event can create UI state.
 * An undecryptable signed event with a known tag hides potentially misleading
 * counts, rather than treating missing ciphertext as an implicit remove.
 */
export async function projectVerifiedDirectReactions(
  rows: readonly ReactionProjectionRow[],
  readPlaintext: (messageId: string) => Promise<CachedDirectReactionPlaintext | null>,
  authoritativeHeadSequence: string,
): Promise<DirectReactionsProjection> {
  const sourceByTag = new Map<string, {
    messageId: string;
    row: ReactionProjectionRow;
    plaintext: string;
  }>();
  const eligibleMessageIds = new Set<string>();
  const unavailableMessageIds = new Set<string>();
  const events: Array<{ verified: VerifiedDirectReaction; sourceMessageId: string }> = [];

  // Only a contiguous, newest-first slice of the authoritative conversation
  // can prove the absence of later add/remove events. An unseen sequence
  // between the observed head and a HUMAN original makes any count for that
  // original misleading. A duplicate row ID is not a second log position.
  // Realtime and pagination may legitimately replay a row, but two
  // different signed/ciphertext identities under the same server ID are
  // equivocation, not two messages. Never let Map(last-wins) silently select
  // an attacker-controlled version before checking the causal prefix.
  const uniqueById = new Map<string, ReactionProjectionRow>();
  const fingerprints = new Map<string, string>();
  for (const row of rows) {
    const message = row.message;
    const fingerprint = JSON.stringify([
      message.conversationId, message.sequence, message.kind,
      message.senderUserId, message.senderDeviceId,
      message.clientMessageId, message.contentCommitmentB64,
      message.reactionTargetTagB64, message.interactionEpoch,
      message.createdAt,
      message.envelope?.recipientDeviceId,
      message.envelope?.headerB64,
      message.envelope?.ciphertextB64,
      message.envelope?.dhPublicB64,
      message.envelope?.messageNumber,
      message.envelope?.previousChainLength,
      message.envelope?.senderSignatureB64,
      message.envelope?.x3dhInit,
      message.mentions,
    ]);
    const previous = fingerprints.get(message.id);
    if (previous !== undefined && previous !== fingerprint) {
      return { states: [], eligibleMessageIds, unavailableMessageIds };
    }
    fingerprints.set(message.id, fingerprint);
    uniqueById.set(message.id, row);
  }
  const parseSequence = (value: string): bigint | null => {
    if (!/^[1-9][0-9]*$/.test(value)) return null;
    try {
      const sequence = BigInt(value);
      return sequence <= 9223372036854775807n ? sequence : null;
    } catch {
      return null;
    }
  };
  const bySequence = [...uniqueById.values()]
    .map((row) => ({ row, sequence: parseSequence(row.message.sequence) }))
    .filter((item): item is { row: ReactionProjectionRow; sequence: bigint } =>
      item.sequence !== null)
    .sort((a, b) => a.sequence < b.sequence ? 1 : a.sequence > b.sequence ? -1 : 0);
  const contiguous = new Set<string>();
  // A locally loaded range cannot prove there are no newer reaction
  // controls. Anchor the contiguous prefix to the server's *complete*
  // conversation high-water sequence, not merely the newest cached row.
  const advertisedHead = authoritativeHeadSequence === "0"
    ? 0n
    : parseSequence(authoritativeHeadSequence);
  let expected = advertisedHead;
  for (const item of bySequence) {
    if (expected === null) break;
    if (item.sequence !== expected) break;
    contiguous.add(item.row.message.id);
    expected -= 1n;
  }

  const humanSourceRows = rows.filter((row) =>
    row.message.kind === "HUMAN" && row.payload?.type === "human" &&
    contiguous.has(row.message.id),
  );
  const cachedSources = await readCachedPlaintexts(
    humanSourceRows.map((row) => row.message.id),
    readPlaintext,
  );
  for (const row of humanSourceRows) {
    // Preserve the explicit discriminant narrowing: a filtered array does
    // not turn mutable/untrusted payload data into a verified HUMAN source.
    if (row.payload?.type !== "human") continue;
    const cached = cachedSources.get(row.message.id) ?? null;
    if (!cachedMatches(cached, row.message)) continue;
    const authenticated = decodeDirectHumanPayload(
      cached.text, row.message.clientMessageId,
      row.message.contentCommitmentB64,
    );
    if (!authenticated ||
        authenticated.text !== row.payload.text ||
        JSON.stringify(authenticated.replyTo ?? null) !==
          JSON.stringify(row.payload.replyTo ?? null)) continue;
    const tag = directReactionTargetTag(
      cached.text, reference(row.message), row.message.conversationId,
    );
    if (!tag) continue;
    sourceByTag.set(tag, { messageId: row.message.id, row, plaintext: cached.text });
    eligibleMessageIds.add(row.message.id);
  }

  // Only controls whose signed opaque tag matches a locally verified
  // original need to open their protected plaintext cache record.
  const targetedReactions = rows.filter((row) =>
    row.message.kind === "REACTION" &&
    !!row.message.reactionTargetTagB64 &&
    sourceByTag.has(row.message.reactionTargetTagB64),
  );
  const cachedEvents = await readCachedPlaintexts(
    targetedReactions
      .filter((row) => contiguous.has(row.message.id))
      .map((row) => row.message.id),
    readPlaintext,
  );
  for (const row of targetedReactions) {
    const tag = row.message.reactionTargetTagB64;
    const source = tag ? sourceByTag.get(tag) : undefined;
    if (!source) continue;
    const eventSequence = parseSequence(row.message.sequence);
    const originalSequence = parseSequence(source.row.message.sequence);
    if (!contiguous.has(row.message.id) || eventSequence === null ||
        originalSequence === null || eventSequence <= originalSequence) {
      unavailableMessageIds.add(source.messageId);
      continue;
    }
    const cached = cachedEvents.get(row.message.id) ?? null;
    if (!cachedMatches(cached, row.message)) {
      unavailableMessageIds.add(source.messageId);
      continue;
    }
    const verified = verifyDirectReaction({
      conversationId: row.message.conversationId,
      senderUserId: row.message.senderUserId,
      clientMessageId: row.message.clientMessageId,
      contentCommitmentB64: row.message.contentCommitmentB64,
      targetTagB64: tag,
      kind: row.message.kind,
      sequence: eventSequence,
    }, cached.text, source.row, source.plaintext);
    if (!verified) {
      unavailableMessageIds.add(source.messageId);
      continue;
    }
    events.push({ verified, sourceMessageId: source.messageId });
  }

  const states = reduceVerifiedDirectReactions(
    events
      .filter((entry) => !unavailableMessageIds.has(entry.sourceMessageId))
      .map((entry) => entry.verified),
  );
  return { states, eligibleMessageIds, unavailableMessageIds };
}
