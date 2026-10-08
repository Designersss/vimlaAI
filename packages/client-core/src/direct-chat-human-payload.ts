import {
  boundHumanClientMessageId,
  boundHumanContentCommitment,
  generateHumanBindingKey,
} from "@vimla/e2ee";
import { readDirectReplyReference, type DirectReplyReference } from "./direct-chat-replies.js";

export interface HumanPayload {
  type: "human";
  text: string;
  replyTo?: DirectReplyReference;
}

/**
 * HUMAN wire v2: every device receives the same E2EE plaintext containing
 * a random 256-bit binding key. Its clientMessageId commits to the canonical
 * text + reply reference without revealing a guessable plaintext hash.
 * Only this wire version is supported (Vimla is preproduction).
 */
export function encodeDirectHumanPayload(payload: HumanPayload): string {
  if (payload.replyTo && !readDirectReplyReference(payload.replyTo)) {
    throw new Error("Invalid Direct reply reference");
  }
  const bindingKey = generateHumanBindingKey();
  return JSON.stringify({
    type: "human",
    version: 2,
    text: payload.text,
    ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
    bindingKey,
  });
}

function parseWire(text: string): {
  payload: HumanPayload;
  bindingKey: string;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const value = parsed as Record<string, unknown>;
  if (
    value.type !== "human" ||
    value.version !== 2 ||
    typeof value.text !== "string" ||
    typeof value.bindingKey !== "string" ||
    Object.keys(value).some((key) =>
      !["type", "version", "text", "replyTo", "bindingKey"].includes(key))
  ) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(value, "replyTo")) {
    return { payload: { type: "human", text: value.text }, bindingKey: value.bindingKey };
  }
  const replyTo = readDirectReplyReference(value.replyTo);
  return replyTo
    ? { payload: { type: "human", text: value.text, replyTo }, bindingKey: value.bindingKey }
    : null;
}

function canonicalContent(payload: HumanPayload): string {
  const ref = payload.replyTo;
  return JSON.stringify([
    payload.text,
    ref
      ? [ref.clientMessageId, ref.contentCommitmentB64, ref.senderUserId, ref.senderDeviceId]
      : null,
  ]);
}

/**
 * The ID and body are indivisible: derive the ID only from exactly the
 * E2EE bytes that will be staged to all recipients. Invalid wire yields null.
 */
export function directHumanContentCommitment(plaintext: string): string | null {
  const parsed = parseWire(plaintext);
  return parsed
    ? boundHumanContentCommitment(parsed.bindingKey, canonicalContent(parsed.payload))
    : null;
}

export function directHumanClientMessageId(plaintext: string): string | null {
  const parsed = parseWire(plaintext);
  return parsed
    ? boundHumanClientMessageId(
      parsed.bindingKey,
      canonicalContent(parsed.payload),
    )
    : null;
}

export function createDirectHumanMessage(payload: HumanPayload): {
  clientMessageId: string;
  contentCommitmentB64: string;
  plaintext: string;
} {
  const plaintext = encodeDirectHumanPayload(payload);
  const clientMessageId = directHumanClientMessageId(plaintext);
  const contentCommitmentB64 = directHumanContentCommitment(plaintext);
  if (!clientMessageId || !contentCommitmentB64) {
    throw new Error("Cannot prepare authenticated Direct HUMAN identity");
  }
  return { clientMessageId, contentCommitmentB64, plaintext };
}

/**
 * Text and reply references are accepted only in a supported typed payload.
 * Optional expected ID verifies the cryptographic commitment before display;
 * callers with signed Direct metadata MUST supply it.
 */
export function decodeDirectHumanPayload(
  text: string,
  expectedClientMessageId?: string,
  expectedContentCommitmentB64?: string | null,
): HumanPayload | null {
  const parsed = parseWire(text);
  if (!parsed) return null;
  const actualId = directHumanClientMessageId(text);
  const full = directHumanContentCommitment(text);
  if (
    !actualId || !full ||
    (expectedClientMessageId !== undefined && actualId !== expectedClientMessageId) ||
    (expectedClientMessageId !== undefined && !expectedContentCommitmentB64) ||
    (expectedContentCommitmentB64 !== undefined &&
      full !== expectedContentCommitmentB64)
  ) {
    return null;
  }
  return parsed.payload;
}
