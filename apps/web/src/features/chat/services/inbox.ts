import {
  INBOX_LIMITS,
  type InboxItem,
  type InboxResponse,
  type CommunicationSurfaceKind,
} from "@vimla/contracts";
import {
  resolveInboxPreview,
} from "@vimla/client-core";
import { createWebClientApi } from "../../../shared/api/client";
import { loadPlaintext } from "../../direct-chats/services/crypto-store";
import { directPlaintextPreview } from "../../direct-chats/services/payload";

export interface FetchInboxInput {
  limit?: number;
  cursor?: string;
  kind?: CommunicationSurfaceKind;
  q?: string;
}

export function fetchInboxItem(
  surfaceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<InboxItem> {
  return createWebClientApi(
    fetchImpl,
  ).inbox.fetchInboxItem(surfaceId);
}

export function fetchInbox(
  input: FetchInboxInput = {},
  fetchImpl: typeof fetch = fetch,
): Promise<InboxResponse> {
  return createWebClientApi(
    fetchImpl,
  ).inbox.fetchInbox(input);
}

export async function resolveWebInboxPreview(
  item: InboxItem,
): Promise<string | null> {
  if (
    item.surfaceKind !== "DIRECT" ||
    item.preview.kind !== "E2EE_LOCAL"
  ) {
    return resolveInboxPreview(item, null);
  }

  try {
    const local = await loadPlaintext(
      item.preview.messageId,
    );
    const plaintext =
      resolveInboxPreview(item, local);
    // An untrusted peer may validly sign different ciphertext to two
    // devices, but HUMAN text must also match its content-bound sender ID.
    // The inbox has a separate plaintext read path from the conversation:
    // never project an unbound/mismatched local row as a valid preview.
    const displayText =
      plaintext === null ||
      (item.preview.messageKind === "HUMAN" && !local?.clientMessageId)
        ? null
        : directPlaintextPreview(
            item.preview.messageKind,
            plaintext,
            local?.clientMessageId,
          );
    return displayText === null
      ? null
      : displayText
          .trim()
          .replace(/\s+/g, " ")
          .slice(
            0,
            INBOX_LIMITS.serverPreviewMax,
          );
  } catch {
    // Local encrypted storage being absent/unavailable must never cause
    // a server plaintext fallback for an E2EE surface.
    return null;
  }
}
