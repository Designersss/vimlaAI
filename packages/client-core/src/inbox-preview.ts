import type {
  InboxItem,
} from "@vimla/contracts";

export interface InboxLocalPlaintextRecord {
  conversationId: string;
  messageId: string;
  text: string;
  kind: string;
  senderUserId: string;
  createdAt: string;
}

export function resolveInboxPreview(
  item: InboxItem,
  localPlaintext: InboxLocalPlaintextRecord | null,
): string | null {
  if (item.surfaceKind === "AI_THREAD") {
    return item.preview.kind === "SERVER_TEXT"
      ? item.preview.text
      : null;
  }

  if (item.preview.kind !== "E2EE_LOCAL") {
    return null;
  }
  if (!localPlaintext) {
    return null;
  }

  return localPlaintext.conversationId ===
      item.domainId &&
    localPlaintext.messageId ===
      item.preview.messageId &&
    localPlaintext.senderUserId ===
      item.preview.senderUserId &&
    localPlaintext.kind ===
      item.preview.messageKind &&
    localPlaintext.createdAt ===
      item.preview.createdAt
    ? localPlaintext.text
    : null;
}
