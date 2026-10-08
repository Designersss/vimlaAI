import type { DirectMessageKind } from "@vimla/contracts";

/**
 * A reference, not a trusted quoted snapshot. Recipient clients must resolve
 * the original authenticated, decrypted HUMAN message in this conversation.
 * Without that source, no peer-attributed quote text may be displayed.
 */
export interface DirectReplyReference {
  messageId: string;
  senderUserId: string;
}

export interface HumanPayload {
  type: "human";
  text: string;
  replyTo?: DirectReplyReference;
}

export interface InvokePayload {
  type: "invoke";
  text: string;
  contextShared: boolean;
  peerIncluded: boolean;
}

export interface ResponsePayload {
  type: "response";
  text: string;
  runId: string;
  clarificationQuestion: string | null;
}

export interface ActionPayload {
  type: "action";
  title: string;
  detail: string | null;
  status: string;
}

export type DirectPlaintextPayload = HumanPayload | InvokePayload | ResponsePayload | ActionPayload;

export function encodeDirectPlaintext(payload: DirectPlaintextPayload): string {
  if (payload.type === "human") {
    if (!payload.replyTo) return payload.text;
    // The reply reference is inside authenticated E2EE plaintext. The
    // server-visible kind remains HUMAN; no message ids or quotes leak via
    // API routing metadata. Version explicitly distinguishes typed payloads.
    if (!readReplyReference(payload.replyTo)) {
      throw new Error("Invalid Direct reply reference");
    }
    return JSON.stringify({
      type: "human",
      version: 1,
      text: payload.text,
      replyTo: payload.replyTo,
    });
  }
  return JSON.stringify(payload);
}

export function decodeDirectPlaintext(kind: DirectMessageKind, text: string): DirectPlaintextPayload {
  if (kind === "HUMAN") {
    const parsed = tryJson(text);
    if (parsed && parsed.type === "human" && typeof parsed.text === "string") {
      if (parsed.version === 1) {
        const replyTo = readReplyReference(parsed.replyTo);
        // Reject malformed or future typed envelopes as unstructured text:
        // never convert attacker-controlled metadata into a trusted quote.
        return replyTo
          ? { type: "human", text: parsed.text, replyTo }
          : { type: "human", text: parsed.text };
      }
      if (parsed.version === undefined && parsed.replyTo === undefined) {
        return { type: "human", text: parsed.text };
      }
    }
    return { type: "human", text };
  }
  const parsed = tryJson(text);
  if (kind === "OPERATOR_INVOKE" && parsed?.type === "invoke" && typeof parsed.text === "string") {
    return {
      type: "invoke",
      text: parsed.text,
      contextShared: parsed.contextShared === true,
      peerIncluded: parsed.peerIncluded === true,
    };
  }
  if (kind === "OPERATOR_RESPONSE" && parsed?.type === "response" && typeof parsed.text === "string" && typeof parsed.runId === "string") {
    return {
      type: "response",
      text: parsed.text,
      runId: parsed.runId,
      clarificationQuestion:
        typeof parsed.clarificationQuestion === "string"
          ? parsed.clarificationQuestion
          : null,
    };
  }
  if (kind === "OPERATOR_ACTION" && parsed?.type === "action" && typeof parsed.title === "string") {
    return {
      type: "action",
      title: parsed.title,
      detail: typeof parsed.detail === "string" ? parsed.detail : null,
      status: typeof parsed.status === "string" ? parsed.status : "success",
    };
  }
  return { type: "human", text };
}

export function directPlaintextPreview(
  kind: DirectMessageKind,
  text: string,
): string | null {
  const payload = decodeDirectPlaintext(kind, text);

  if (kind === "HUMAN") {
    return payload.type === "human" ? payload.text : null;
  }
  if (kind === "OPERATOR_INVOKE") {
    return payload.type === "invoke" ? payload.text : null;
  }
  if (kind === "OPERATOR_RESPONSE") {
    return payload.type === "response"
      ? payload.text || payload.clarificationQuestion
      : null;
  }
  if (kind === "OPERATOR_ACTION") {
    return payload.type === "action" ? payload.title : null;
  }

  const exhaustive: never = kind;
  return exhaustive;
}

function tryJson(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// Only an authenticated, structurally valid reference may be considered for
// LOCAL resolution. An arbitrary id is never proof that the source exists.
function readReplyReference(input: unknown): DirectReplyReference | null {
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
