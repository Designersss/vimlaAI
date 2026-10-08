import { readDirectReplyReference, type DirectReplyReference } from "./direct-chat-replies.js";

export interface HumanPayload {
  type: "human";
  text: string;
  replyTo?: DirectReplyReference;
}

/**
 * One canonical typed HUMAN plaintext for newly authored Direct messages.
 * It is encrypted and signed by the per-device E2EE envelope, not exposed
 * through server metadata. Raw older HUMAN text is still decoded as text.
 */
export function encodeDirectHumanPayload(payload: HumanPayload): string {
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

/**
 * Clean preproduction Direct HUMAN wire protocol: ONLY strict version-1
 * envelopes are accepted. A raw JSON string and a malformed/future typed
 * envelope cannot masquerade as a legitimate authored message or quote.
 * There are no released clients or production Direct history to migrate.
 */
export function decodeDirectHumanPayload(text: string): HumanPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const value = parsed as Record<string, unknown>;
  const keys = Object.keys(value);
  if (
    value.type !== "human" ||
    value.version !== 1 ||
    typeof value.text !== "string" ||
    keys.some((key) => !["type", "version", "text", "replyTo"].includes(key))
  ) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(value, "replyTo")) {
    return { type: "human", text: value.text };
  }
  const replyTo = readDirectReplyReference(value.replyTo);
  return replyTo
    ? { type: "human", text: value.text, replyTo }
    : null;
}
