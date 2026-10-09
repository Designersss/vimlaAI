import type { DirectMessageView } from "@vimla/contracts";

/**
 * Detect equivocation across independently fetched copies of one immutable
 * Direct event. Ciphertext and sender-signed envelope must not be replaced
 * just because the server reused an existing message ID.
 *
 * This fingerprint is an equality check, not a cryptographic attestation.
 * Signature/commitment/source verification remains separately required.
 */
export function directMessageReplicaFingerprint(message: DirectMessageView): string {
  return JSON.stringify([
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
}

export function sameDirectMessageReplica(a: DirectMessageView, b: DirectMessageView): boolean {
  return a.id === b.id &&
    directMessageReplicaFingerprint(a) === directMessageReplicaFingerprint(b);
}

/**
 * Scan untrusted server-provided rows BEFORE E2EE ratchet operations.
 * Two copies of one server ID with different immutable signed-envelope
 * metadata cannot safely be decrypted in sequence: the second may move
 * Double Ratchet state before downstream UI reconciliation notices it.
 * Exact wire replays are permitted.
 */
export function hasConflictingDirectMessageReplicas(
  messages: readonly DirectMessageView[],
  priorMessages: readonly DirectMessageView[] = [],
): boolean {
  // Baseline rows were already accepted by the local surface; no page may
  // silently replace their immutable sender-signed identity. Include pages
  // visited earlier in the same catch-up for cross-page equivocation.
  const byId = new Map<string, string>();
  // The PostgreSQL append-only log assigns a globally unique sequence per
  // conversation. A malicious API response may copy one valid signed E2EE
  // envelope under a NEW server ID at the same sequence: comparing only
  // existing IDs would miss this causal equivocation before ratchet commit.
  const bySequence = new Map<string, string>();
  for (const message of [...priorMessages, ...messages]) {
    const fingerprint = directMessageReplicaFingerprint(message);
    const previous = byId.get(message.id);
    const sequenceKey = JSON.stringify([message.conversationId, message.sequence]);
    const priorOwner = bySequence.get(sequenceKey);
    if ((previous !== undefined && previous !== fingerprint) ||
        (priorOwner !== undefined && priorOwner !== message.id)) {
      return true;
    }
    byId.set(message.id, fingerprint);
    bySequence.set(sequenceKey, message.id);
  }
  return false;
}

/**
 * Platform-neutral merge of decrypted Direct pages and realtime duplicates.
 * A conflicting immutable event permanently poisons its local slot for this
 * surface lifecycle; a later X3DH bootstrap or exact replay cannot silently
 * turn it back into trusted plaintext. Explicitly reopening/rebuilding the
 * whole surface is a separate trust operation.
 */
export interface DirectMessageReplicaRow<TPayload> {
  message: DirectMessageView;
  payload: TPayload | null;
  needsBootstrap: boolean;
  integrityConflict?: boolean;
}

export function mergeDirectMessageReplicaRows<TPayload>(
  current: readonly DirectMessageReplicaRow<TPayload>[],
  incoming: readonly DirectMessageReplicaRow<TPayload>[],
): DirectMessageReplicaRow<TPayload>[] {
  const byId = new Map(current.map((row) => [row.message.id, row]));
  for (const row of incoming) {
    const previous = byId.get(row.message.id);
    if (previous?.integrityConflict) continue;
    if (previous && !sameDirectMessageReplica(previous.message, row.message)) {
      byId.set(row.message.id, {
        ...previous,
        payload: null,
        needsBootstrap: false,
        integrityConflict: true,
      });
      continue;
    }
    byId.set(row.message.id, row);
  }
  // Defend portable callers that did not run the raw-page preflight.
  // Never let two different IDs claim the same authoritative log slot and
  // expose either as authenticated history. Poison both ambiguous owners.
  const bySequence = new Map<string, string>();
  const poisoned = new Set<string>();
  for (const row of byId.values()) {
    const key = JSON.stringify([row.message.conversationId, row.message.sequence]);
    const owner = bySequence.get(key);
    if (owner !== undefined && owner !== row.message.id) {
      poisoned.add(owner);
      poisoned.add(row.message.id);
    } else {
      bySequence.set(key, row.message.id);
    }
  }
  for (const id of poisoned) {
    const row = byId.get(id);
    if (row) {
      byId.set(id, { ...row, payload: null, needsBootstrap: false, integrityConflict: true });
    }
  }
  return [...byId.values()].sort((left, right) =>
    BigInt(left.message.sequence) < BigInt(right.message.sequence) ? -1 :
    BigInt(left.message.sequence) > BigInt(right.message.sequence) ? 1 : 0,
  );
}
