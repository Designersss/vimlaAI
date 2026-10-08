import type { DirectMessageView } from "@vimla/contracts";

/**
 * Sender-authenticated quote references are *claims*, not attestations.
 * Verify provenance only against the original authenticated, decrypted
 * HUMAN message within the same Direct conversation.
 */
export interface DirectReplyReference {
  messageId: string;
  senderUserId: string;
}

export interface LocalDirectReplySource {
  message: Pick<
    DirectMessageView,
    "id" | "conversationId" | "senderUserId" | "kind"
  >;
  payload: { type: string } | null;
}

export function readDirectReplyReference(input: unknown): DirectReplyReference | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const value = input as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    Object.keys(value).length !== 2 ||
    typeof value.messageId !== "string" ||
    !uuid.test(value.messageId) ||
    typeof value.senderUserId !== "string" ||
    value.senderUserId.length < 1 ||
    value.senderUserId.length > 128
  ) {
    return null;
  }
  return {
    messageId: value.messageId,
    senderUserId: value.senderUserId,
  };
}

export function directReplyReference(
  source: LocalDirectReplySource,
): DirectReplyReference {
  return {
    messageId: source.message.id,
    senderUserId: source.message.senderUserId,
  };
}

export function resolveDirectReplySource<T extends LocalDirectReplySource>(
  source: T | undefined,
  conversationId: string,
  reference: DirectReplyReference,
): T | null {
  if (
    !source ||
    source.message.id !== reference.messageId ||
    source.message.conversationId !== conversationId ||
    source.message.senderUserId !== reference.senderUserId ||
    source.message.kind !== "HUMAN" ||
    source.payload?.type !== "human"
  ) {
    return null;
  }
  return source;
}
