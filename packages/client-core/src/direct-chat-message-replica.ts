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
