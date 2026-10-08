import {
  boundReactionEventCommitment,
  boundReactionTargetTag,
  generateHumanBindingKey,
  reactionClientIdFromCommitment,
} from "@vimla/e2ee";
import {
  readDirectReplyReference,
  resolveDirectReplySource,
  type DirectReplyReference,
  type LocalDirectReplySource,
} from "./direct-chat-replies.js";
import {
  decodeDirectHumanPayload,
} from "./direct-chat-human-payload.js";

/**
 * This first slice is deliberately separate from the server send transport.
 * Upstream callers must first authenticate the original HUMAN source under
 * its sender's signed Direct AD5 and verify the cached provenance.
 */
export const DIRECT_REACTION_EMOJIS = [
  "👍", "❤️", "😂", "😮", "😢", "🙏", "🔥",
] as const;

export type DirectReactionEmoji = (typeof DIRECT_REACTION_EMOJIS)[number];
export type DirectReactionAction = "add" | "remove";

export interface DirectReactionPayload {
  type: "reaction";
  action: DirectReactionAction;
  emoji: DirectReactionEmoji;
  target: DirectReplyReference;
}

export interface PreparedDirectReaction {
  clientMessageId: string;
  contentCommitmentB64: string;
  // Only the opaque index tag is exposed as anticipated API routing metadata.
  targetTagB64: string;
  plaintext: string;
}

interface ParsedReactionWire {
  payload: DirectReactionPayload;
  bindingKey: string;
}

export function isDirectReactionEmoji(input: unknown): input is DirectReactionEmoji {
  return typeof input === "string" &&
    (DIRECT_REACTION_EMOJIS as readonly string[]).includes(input);
}

function parseReactionWire(plaintext: string): ParsedReactionWire | null {
  // Reject oversized control plaintext before JSON parsing/allocations.
  if (plaintext.length > 2048) return null;
  let input: unknown;
  try {
    input = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (
    Object.keys(record).length !== 6 ||
    Object.keys(record).some((key) =>
      !["type", "version", "action", "emoji", "target", "bindingKey"].includes(key)) ||
    record.type !== "reaction" ||
    record.version !== 1 ||
    (record.action !== "add" && record.action !== "remove") ||
    !isDirectReactionEmoji(record.emoji) ||
    typeof record.bindingKey !== "string"
  ) {
    return null;
  }
  const target = readDirectReplyReference(record.target);
  if (!target) return null;
  return {
    bindingKey: record.bindingKey,
    payload: { type: "reaction", action: record.action, emoji: record.emoji, target },
  };
}

function canonicalReaction(payload: DirectReactionPayload): string {
  const t = payload.target;
  return JSON.stringify([
    payload.action,
    payload.emoji,
    [t.clientMessageId, t.contentCommitmentB64, t.senderUserId, t.senderDeviceId],
  ]);
}

function canonicalTarget(conversationId: string, source: DirectReplyReference): string {
  return JSON.stringify([
    conversationId,
    source.clientMessageId,
    source.contentCommitmentB64,
    source.senderUserId,
    source.senderDeviceId,
  ]);
}

/**
 * Compute an opaque query tag from an already-authenticated HUMAN v2 source.
 * Checking only the source's UUID prefix or trusting a sender-written
 * quoted-text snapshot is insufficient.
 */
export function directReactionTargetTag(
  originalHumanPlaintext: string,
  source: DirectReplyReference,
  conversationId: string,
): string | null {
  if (!conversationId ||
      !readDirectReplyReference(source) ||
      !decodeDirectHumanPayload(
        originalHumanPlaintext, source.clientMessageId, source.contentCommitmentB64,
      )) {
    return null;
  }
  let input: unknown;
  try {
    input = JSON.parse(originalHumanPlaintext);
  } catch {
    return null;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const key = (input as Record<string, unknown>).bindingKey;
  return typeof key === "string"
    ? boundReactionTargetTag(key, canonicalTarget(conversationId, source))
    : null;
}

/**
 * The source must already be authenticated by the Direct session. Independently
 * require that its locally displayed text equals the canonical v2 plaintext
 * and matches the complete signed original metadata.
 */
export function resolveDirectReactionSource<T extends LocalDirectReplySource>(
  source: T | undefined,
  originalHumanPlaintext: string,
  conversationId: string,
  target: DirectReplyReference,
  expectedTargetTagB64: string,
): T | null {
  const verified = resolveDirectReplySource(source, conversationId, target);
  if (!verified ||
      !decodeDirectHumanPayload(
        originalHumanPlaintext,
        target.clientMessageId,
        target.contentCommitmentB64,
      ) ||
      directReactionTargetTag(originalHumanPlaintext, target, conversationId) !==
        expectedTargetTagB64) {
    return null;
  }
  const decoded = decodeDirectHumanPayload(
    originalHumanPlaintext,
    target.clientMessageId,
    target.contentCommitmentB64,
  );
  return decoded?.text === verified.payload?.text ? verified : null;
}

export function createDirectReaction(
  action: DirectReactionAction,
  emoji: DirectReactionEmoji,
  source: LocalDirectReplySource,
  originalHumanPlaintext: string,
  conversationId: string,
): PreparedDirectReaction {
  if (!isDirectReactionEmoji(emoji) || (action !== "add" && action !== "remove")) {
    throw new Error("Invalid Direct reaction");
  }
  const target: DirectReplyReference = {
    clientMessageId: source.message.clientMessageId,
    contentCommitmentB64: source.message.contentCommitmentB64 ?? "",
    senderUserId: source.message.senderUserId,
    senderDeviceId: source.message.senderDeviceId,
  };
  const targetTagB64 = directReactionTargetTag(originalHumanPlaintext, target, conversationId);
  if (!targetTagB64 ||
      !resolveDirectReactionSource(
        source, originalHumanPlaintext, conversationId, target, targetTagB64,
      )) {
    throw new Error("Direct reaction source is not authenticated");
  }
  const bindingKey = generateHumanBindingKey();
  const payload: DirectReactionPayload = { type: "reaction", action, emoji, target };
  const contentCommitmentB64 = boundReactionEventCommitment(
    bindingKey, canonicalReaction(payload),
  );
  const clientMessageId = contentCommitmentB64
    ? reactionClientIdFromCommitment(contentCommitmentB64)
    : null;
  if (!clientMessageId || !contentCommitmentB64) {
    throw new Error("Invalid Direct reaction commitment");
  }
  return {
    clientMessageId,
    contentCommitmentB64,
    targetTagB64,
    plaintext: JSON.stringify({
      type: "reaction", version: 1, action, emoji, target, bindingKey,
    }),
  };
}

/** Only accepted when complete sender-signed metadata matches the E2EE wire. */
export function decodeDirectReaction(
  plaintext: string,
  signedClientMessageId: string,
  signedContentCommitmentB64: string,
): DirectReactionPayload | null {
  const parsed = parseReactionWire(plaintext);
  if (!parsed) return null;
  const commitment = boundReactionEventCommitment(
    parsed.bindingKey, canonicalReaction(parsed.payload),
  );
  return commitment &&
    commitment === signedContentCommitmentB64 &&
    reactionClientIdFromCommitment(commitment) === signedClientMessageId
      ? parsed.payload
      : null;
}

export interface SignedDirectReactionMetadata {
  conversationId: string;
  senderUserId: string;
  clientMessageId: string;
  contentCommitmentB64: string | null;
  // Authenticated in sender-signed associated data, not an unsigned lookup hint.
  targetTagB64: string | null;
  kind: string;
  sequence: bigint;
}

export interface VerifiedDirectReaction {
  eventClientMessageId: string;
  sequence: bigint;
  reactorUserId: string;
  action: DirectReactionAction;
  emoji: DirectReactionEmoji;
  target: DirectReplyReference;
}

/**
 * All metadata MUST originate from a verified sender-signed envelope (and
 * sequence from the authoritative server). This function is the final local
 * target-provenance gate before a reaction may enter the state reducer.
 */
export function verifyDirectReaction(
  metadata: SignedDirectReactionMetadata,
  plaintext: string,
  source: LocalDirectReplySource | undefined,
  originalHumanPlaintext: string,
): VerifiedDirectReaction | null {
  if (metadata.kind !== "REACTION" ||
      !metadata.senderUserId ||
      !metadata.conversationId ||
      !metadata.contentCommitmentB64 ||
      !metadata.targetTagB64 ||
      metadata.sequence <= 0n) return null;
  const payload = decodeDirectReaction(
    plaintext, metadata.clientMessageId, metadata.contentCommitmentB64,
  );
  if (!payload ||
      !resolveDirectReactionSource(
        source, originalHumanPlaintext, metadata.conversationId,
        payload.target, metadata.targetTagB64,
      )) {
    return null;
  }
  return {
    eventClientMessageId: metadata.clientMessageId,
    sequence: metadata.sequence,
    reactorUserId: metadata.senderUserId,
    action: payload.action,
    emoji: payload.emoji,
    target: payload.target,
  };
}
