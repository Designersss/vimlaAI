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

/**
 * Platform-independent E2EE reaction projection, with cache access injected
 * by Web/Desktop/Mobile. All rows must form a contiguous, causally ordered
 * head-to-original interval. Signatures and local cache protection must be
 * checked by the caller BEFORE admitting a stored plaintext.
 *
 * A tag is only a correlation hint: no unverified event can create UI state.
 * An undecryptable signed event with a known tag hides potentially misleading
 * counts, rather than treating missing ciphertext as an implicit remove.
 */
export async function projectVerifiedDirectReactions(
  rows: readonly ReactionProjectionRow[],
  readPlaintext: (messageId: string) => Promise<CachedDirectReactionPlaintext | null>,
): Promise<DirectReactionsProjection> {
  const sourceByTag = new Map<string, {
    messageId: string;
    row: ReactionProjectionRow;
    plaintext: string;
  }>();
  const eligibleMessageIds = new Set<string>();
  const unavailableMessageIds = new Set<string>();
  const events: Array<{ verified: VerifiedDirectReaction; sourceMessageId: string }> = [];

  for (const row of rows) {
    if (row.message.kind !== "HUMAN" || row.payload?.type !== "human") continue;
    const cached = await readPlaintext(row.message.id);
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

  for (const row of rows) {
    if (row.message.kind !== "REACTION") continue;
    const tag = row.message.reactionTargetTagB64;
    const source = tag ? sourceByTag.get(tag) : undefined;
    if (!source) continue;
    const cached = await readPlaintext(row.message.id);
    if (!cachedMatches(cached, row.message)) {
      unavailableMessageIds.add(source.messageId);
      continue;
    }
    let sequence: bigint;
    try {
      sequence = BigInt(row.message.sequence);
    } catch {
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
      sequence,
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
