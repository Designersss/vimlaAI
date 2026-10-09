import type { DirectMessageView } from "@vimla/contracts";
import {
  cachedDirectPlaintextMatchesMessage,
  decodeDirectHumanPayload,
  directReactionTargetTag,
  reduceVerifiedDirectReactions,
  verifyDirectReaction,
  type DirectReactionState,
  type DirectReplyReference,
  type HumanPayload,
  type VerifiedDirectReaction,
} from "@vimla/client-core";
import { loadPlaintext, type StoredPlaintext } from "./crypto-store";

export interface ReactionProjectionRow {
  message: DirectMessageView;
  payload: { type: "human"; text: string; replyTo?: HumanPayload["replyTo"] } | null;
}

export interface DirectReactionsProjection {
  states: DirectReactionState[];
  // Only authentic, locally decryptable HUMAN sources may offer a picker.
  eligibleMessageIds: ReadonlySet<string>;
  // If a signed reaction targeting a known source cannot be verified or
  // decrypted, never display possibly misleading counts for that source.
  unavailableMessageIds: ReadonlySet<string>;
}

function cachedMatches(
  cached: StoredPlaintext | null,
  message: DirectMessageView,
): cached is StoredPlaintext {
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
 * Bounded by already-loaded, chronological Direct history. The server's
 * source tag is only a lookup hint: an emoji is projected exclusively after
 * ratchet-authenticated cached plaintext and original HUMAN provenance.
 *
 * The caller must supply a contiguous head-to-source history interval.
 * A missing, undecryptable or forged reaction inside that interval makes
 * the original's reaction state unavailable, not a false zero.
 */
export async function projectDirectReactions(
  rows: readonly ReactionProjectionRow[],
  read: (id: string) => Promise<StoredPlaintext | null> = loadPlaintext,
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
    const stored = await read(row.message.id);
    if (!cachedMatches(stored, row.message)) continue;
    const sourcePayload = decodeDirectHumanPayload(
      stored.text, row.message.clientMessageId,
      row.message.contentCommitmentB64,
    );
    if (!sourcePayload ||
        sourcePayload.text !== row.payload.text ||
        JSON.stringify(sourcePayload.replyTo ?? null) !==
          JSON.stringify(row.payload.replyTo ?? null)) continue;
    const tag = directReactionTargetTag(
      stored.text, reference(row.message), row.message.conversationId,
    );
    if (!tag) continue;
    sourceByTag.set(tag, { messageId: row.message.id, row, plaintext: stored.text });
    eligibleMessageIds.add(row.message.id);
  }

  for (const row of rows) {
    if (row.message.kind !== "REACTION") continue;
    const tag = row.message.reactionTargetTagB64;
    const source = tag ? sourceByTag.get(tag) : undefined;
    if (!source) continue;
    const cached = await read(row.message.id);
    if (!cachedMatches(cached, row.message)) {
      unavailableMessageIds.add(source.messageId);
      continue;
    }
    const metadata = row.message;
    const verified = verifyDirectReaction({
      conversationId: metadata.conversationId,
      senderUserId: metadata.senderUserId,
      clientMessageId: metadata.clientMessageId,
      contentCommitmentB64: metadata.contentCommitmentB64,
      targetTagB64: tag,
      kind: metadata.kind,
      sequence: BigInt(metadata.sequence),
    }, cached.text, source.row, source.plaintext);
    if (!verified) {
      unavailableMessageIds.add(source.messageId);
      continue;
    }
    events.push({ verified, sourceMessageId: source.messageId });
  }

  const validEvents = events
    .filter((event) => !unavailableMessageIds.has(event.sourceMessageId))
    .map((event) => event.verified);
  const states = reduceVerifiedDirectReactions(validEvents);
  return { states, eligibleMessageIds, unavailableMessageIds };
}
