import type { DirectMessageKind } from "@vimla/contracts";
import { readDirectReplyReference, type DirectReplyReference } from "@vimla/client-core";
export type { DirectReplyReference } from "@vimla/client-core";

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
    // All newly authored HUMAN messages use one canonical versioned
    // plaintext envelope. The user's literal JSON text stays user text:
    // it cannot be misinterpreted as a reply reference on another device.
    // The reference is entirely inside signed E2EE ciphertext.
    if (payload.replyTo && !readDirectReplyReference(payload.replyTo)) {
      throw new Error("Invalid Direct reply reference");
    }
    return JSON.stringify({
      type: "human",
      version: 1,
      text: payload.text,
      ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
    });
  }
  return JSON.stringify(payload);
}

export function decodeDirectPlaintext(kind: DirectMessageKind, text: string): DirectPlaintextPayload {
  if (kind === "HUMAN") {
    const parsed = tryJson(text);
    if (parsed && parsed.type === "human" && typeof parsed.text === "string") {
      if (parsed.version === 1) {
        const replyTo = readDirectReplyReference(parsed.replyTo);
        // Invalid/unknown references never create a source attribution.
        return replyTo
          ? { type: "human", text: parsed.text, replyTo }
          : { type: "human", text: parsed.text };
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
