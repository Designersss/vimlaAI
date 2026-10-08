import type { DirectMessageView } from "@vimla/contracts";

/**
 * Sender-authenticated quote references are *claims*, not attestations.
 * Verify provenance only against the original authenticated, decrypted
 * HUMAN message within the same Direct conversation.
 */
export interface DirectReplyReference {
  // The client-generated id is signed into each sender E2EE envelope;
  // unlike server-generated message.id it cannot be relabelled by the server.
  clientMessageId: string;
  // Signed 256-bit source commitment, necessary to avoid 122-bit UUID collisions.
  contentCommitmentB64: string;
  senderUserId: string;
  senderDeviceId: string;
}

export interface LocalDirectReplySource {
  message: Pick<
    DirectMessageView,
    "clientMessageId" | "contentCommitmentB64" | "conversationId" | "senderUserId" | "senderDeviceId" | "kind"
  >;
  payload: { type: string; text?: unknown } | null;
}

export function readDirectReplyReference(input: unknown): DirectReplyReference | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const value = input as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    Object.keys(value).length !== 4 ||
    typeof value.contentCommitmentB64 !== "string" ||
    !/^[A-Za-z0-9+/]{43}=$/.test(value.contentCommitmentB64) ||
    typeof value.clientMessageId !== "string" ||
    !uuid.test(value.clientMessageId) ||
    typeof value.senderUserId !== "string" ||
    value.senderUserId.length < 1 ||
    value.senderUserId.length > 128 ||
    typeof value.senderDeviceId !== "string" ||
    !uuid.test(value.senderDeviceId)
  ) {
    return null;
  }
  return {
    clientMessageId: value.clientMessageId,
    contentCommitmentB64: value.contentCommitmentB64,
    senderUserId: value.senderUserId,
    senderDeviceId: value.senderDeviceId,
  };
}

export function directReplyReference(
  source: LocalDirectReplySource,
): DirectReplyReference | null {
  if (source.message.kind !== "HUMAN" || !source.message.contentCommitmentB64) return null;
  return {
    clientMessageId: source.message.clientMessageId,
    contentCommitmentB64: source.message.contentCommitmentB64,
    senderUserId: source.message.senderUserId,
    senderDeviceId: source.message.senderDeviceId,
  };
}

export function resolveDirectReplySource<T extends LocalDirectReplySource>(
  source: T | undefined,
  conversationId: string,
  reference: DirectReplyReference,
): T | null {
  if (
    !source ||
    source.message.clientMessageId !== reference.clientMessageId ||
    source.message.contentCommitmentB64 !== reference.contentCommitmentB64 ||
    source.message.conversationId !== conversationId ||
    source.message.senderUserId !== reference.senderUserId ||
    source.message.senderDeviceId !== reference.senderDeviceId ||
    source.message.kind !== "HUMAN" ||
    source.payload?.type !== "human" ||
    typeof source.payload.text !== "string"
  ) {
    return null;
  }
  return source;
}
