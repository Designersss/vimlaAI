/**
 * A ratchet-authenticated local plaintext cache can be reused only for the
 * exact server message identity and immutable metadata it was originally
 * verified against. The cached body alone is not E2EE attribution evidence:
 * a server can relabel message metadata when the plaintext is already local.
 */
export interface CachedDirectPlaintextProvenance {
  messageId: string;
  conversationId: string;
  senderUserId: string;
  senderDeviceId?: string;
  interactionEpoch?: number;
  kind: string;
  createdAt: string;
}

export function cachedDirectPlaintextMatchesMessage(
  cached: CachedDirectPlaintextProvenance,
  expected: CachedDirectPlaintextProvenance,
): boolean {
  return (
    cached.messageId === expected.messageId &&
    cached.conversationId === expected.conversationId &&
    cached.senderUserId === expected.senderUserId &&
    typeof cached.senderDeviceId === "string" &&
    cached.senderDeviceId === expected.senderDeviceId &&
    typeof cached.interactionEpoch === "number" &&
    cached.interactionEpoch === expected.interactionEpoch &&
    cached.kind === expected.kind &&
    cached.createdAt === expected.createdAt
  );
}
