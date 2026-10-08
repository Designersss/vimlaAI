import type { DirectMessageKind } from "@vimla/contracts";
import {
  decodeDirectHumanPayload,
  encodeDirectHumanPayload,
  type HumanPayload,
} from "@vimla/client-core";
export type { HumanPayload, DirectReplyReference } from "@vimla/client-core";

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
    return encodeDirectHumanPayload(payload);
  }
  return JSON.stringify(payload);
}

export function decodeDirectPlaintext(
  kind: DirectMessageKind,
  text: string,
  expectedClientMessageId?: string,
): DirectPlaintextPayload | null {
  if (kind === "HUMAN") {
    return decodeDirectHumanPayload(text, expectedClientMessageId);
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
  expectedClientMessageId?: string,
): string | null {
  const payload = decodeDirectPlaintext(kind, text, expectedClientMessageId);
  if (!payload) return null;

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
