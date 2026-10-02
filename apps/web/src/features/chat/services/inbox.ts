import type {
  InboxItem,
  InboxResponse,
  CommunicationSurfaceKind,
} from "@vimla/contracts";
import {
  resolveInboxPreview,
} from "@vimla/client-core";
import { createWebClientApi } from "../../../shared/api/client";
import { loadPlaintext } from "../../direct-chats/services/crypto-store";

export interface FetchInboxInput {
  limit?: number;
  cursor?: string;
  kind?: CommunicationSurfaceKind;
  q?: string;
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
    return resolveInboxPreview(item, local);
  } catch {
    // Local encrypted storage being absent/unavailable must never cause
    // a server plaintext fallback for an E2EE surface.
    return null;
  }
}
