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

export function decodeDirectHumanPayload(text: string): HumanPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { type: "human", text };
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return { type: "human", text };
  }
  const value = parsed as Record<string, unknown>;
  if (
    value.type !== "human" ||
    value.version !== 1 ||
    typeof value.text !== "string"
  ) {
    // Unknown protocol versions stay raw, including all control fields;
    // do not attribute or interpret any unverifiable quoted content.
    return { type: "human", text };
  }
  const replyTo = readDirectReplyReference(value.replyTo);
  return replyTo
    ? { type: "human", text: value.text, replyTo }
    : { type: "human", text: value.text };
}
