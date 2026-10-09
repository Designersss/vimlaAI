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
  return [...byId.values()].sort((left, right) =>
    BigInt(left.message.sequence) < BigInt(right.message.sequence) ? -1 :
    BigInt(left.message.sequence) > BigInt(right.message.sequence) ? 1 : 0,
  );
}
