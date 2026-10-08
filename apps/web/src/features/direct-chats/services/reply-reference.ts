import type { DirectMessageView } from "@vimla/contracts";
import type { DirectPlaintextPayload, DirectReplyReference } from "./payload";

/**
 * Recipient-side provenance check. A signed reply proves who authored the
 * *reference*, not the existence, authorship or text of its alleged source.
 * The UI may attribute a quote to the peer only when a locally decrypted
 * and authenticated source message matches the exact immutable identity.
 */
export interface LocalDirectReplySource {
  message: Pick<
    DirectMessageView,
    "id" | "conversationId" | "senderUserId" | "kind"
  >;
  payload: DirectPlaintextPayload | null;
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
