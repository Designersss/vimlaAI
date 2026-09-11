import type { DirectMessageKind } from "@vimla/contracts";

export interface HumanPayload {
  type: "human";
  text: string;
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
    return payload.text;
  }
  return JSON.stringify(payload);
}

export function decodeDirectPlaintext(kind: DirectMessageKind, text: string): DirectPlaintextPayload {
  if (kind === "HUMAN") {
    const parsed = tryJson(text);
    if (parsed && parsed.type === "human" && typeof parsed.text === "string") {
      return { type: "human", text: parsed.text };
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
    return { type: "response", text: parsed.text, runId: parsed.runId };
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
