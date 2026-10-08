import type {
  DirectReactionEmoji,
  VerifiedDirectReaction,
} from "./direct-chat-reactions.js";
import type { DirectReplyReference } from "./direct-chat-replies.js";

export interface DirectReactionState {
  target: DirectReplyReference;
  reactorUserId: string;
  emoji: DirectReactionEmoji;
  active: boolean;
  latestSequence: bigint;
}

/**
 * A deterministic, append-only projection of ALREADY VERIFIED E2EE events.
 * Realtime may replay or reorder them; only the authoritative conversation
 * sequence, never client timestamps, resolves add/remove races.
 *
 * A conflicting duplicate sequence or client id is corrupt server history:
 * fail closed instead of silently picking a potentially forged state.
 */
export function reduceVerifiedDirectReactions(
  input: readonly VerifiedDirectReaction[],
): DirectReactionState[] {
  const byStateKey = new Map<string, DirectReactionState>();
  const byEventId = new Map<string, VerifiedDirectReaction>();
  const bySequence = new Map<bigint, string>();
  const sorted = [...input].sort((a, b) =>
    a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : 0
  );
  for (const event of sorted) {
    if (event.sequence <= 0n) throw new Error("Invalid reaction sequence");
    const fingerprint = JSON.stringify([
      event.reactorUserId, event.action, event.emoji,
      event.target.clientMessageId, event.target.contentCommitmentB64,
      event.target.senderUserId, event.target.senderDeviceId,
    ]);
    // Server idempotency is per (conversation, senderUser, clientId), not
    // globally by clientId. Two legitimate actors may intentionally share
    // signed payload bytes without sharing sender identity.
    const eventIdentity = JSON.stringify([event.reactorUserId, event.eventClientMessageId]);
    const previous = byEventId.get(eventIdentity);
    if (previous) {
      const previousFingerprint = JSON.stringify([
        previous.reactorUserId, previous.action, previous.emoji,
        previous.target.clientMessageId, previous.target.contentCommitmentB64,
        previous.target.senderUserId, previous.target.senderDeviceId,
      ]);
      if (previous.sequence !== event.sequence || previousFingerprint !== fingerprint) {
        throw new Error("Conflicting Direct reaction replay");
      }
      continue;
    }
    const otherIdentity = bySequence.get(event.sequence);
    if (otherIdentity && otherIdentity !== eventIdentity) {
      throw new Error("Conflicting Direct reaction sequence");
    }
    bySequence.set(event.sequence, eventIdentity);
    byEventId.set(eventIdentity, event);
    const target = event.target;
    const key = JSON.stringify([
      target.clientMessageId, target.contentCommitmentB64,
      target.senderUserId, target.senderDeviceId,
      event.reactorUserId, event.emoji,
    ]);
    byStateKey.set(key, {
      target, reactorUserId: event.reactorUserId, emoji: event.emoji,
      active: event.action === "add", latestSequence: event.sequence,
    });
  }
  return [...byStateKey.values()].sort((a, b) =>
    a.latestSequence < b.latestSequence ? -1 :
      a.latestSequence > b.latestSequence ? 1 : 0
  );
}
