import {
  DIRECT_CHAT_LIMITS,
  operatorContextBundleSchema,
  type DirectConversationPrivacy,
  type OperatorContextBundle,
} from "@vimla/contracts";
import type { StoredPlaintext } from "./crypto-store";

const RAW_TAIL_LIMIT = 8;
const LOCAL_SCAN_LIMIT = 256;

export interface PreparedDirectChatContext {
  contextBundle: OperatorContextBundle;
  ownIncluded: boolean;
  peerIncluded: boolean;
}

export function prepareDirectChatContext(input: {
  actorUserId: string;
  privacy: DirectConversationPrivacy;
  query: string;
  messages: readonly StoredPlaintext[];
}): PreparedDirectChatContext {
  const deduped = new Map<string, StoredPlaintext>();
  for (const message of input.messages.slice(0, LOCAL_SCAN_LIMIT)) {
    if (
      message.kind !== "HUMAN" ||
      !message.messageId ||
      !Number.isFinite(Date.parse(message.createdAt))
    ) {
      continue;
    }
    deduped.set(message.messageId, message);
  }

  const eligible = [...deduped.values()]
    .filter((message) => {
      const own = message.senderUserId === input.actorUserId;
      if (own) return input.privacy.shareOwnHistoryWithVimla;
      return (
        input.privacy.includePeerHistoryWhenInvoking &&
        input.privacy.peerShareOwnHistoryWithVimla
      );
    })
    .sort(
      (left, right) =>
        Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
        left.messageId.localeCompare(right.messageId),
    );

  const tail = eligible.slice(-RAW_TAIL_LIMIT);
  const tailIds = new Set(tail.map((message) => message.messageId));
  const terms = queryTerms(input.query);
  const older = eligible
    .filter((message) => !tailIds.has(message.messageId))
    .map((message) => ({
      message,
      score: lexicalScore(message.text, terms),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        Date.parse(right.message.createdAt) -
          Date.parse(left.message.createdAt),
    )
    .slice(0, DIRECT_CHAT_LIMITS.contextMessagesMax - tail.length)
    .map((entry) => entry.message);

  const selected = [...older, ...tail].sort(
    (left, right) =>
      Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
      left.messageId.localeCompare(right.messageId),
  );

  const messages: OperatorContextBundle["messages"] = [];
  let aggregateChars = 0;
  for (const message of selected) {
    if (messages.length >= DIRECT_CHAT_LIMITS.contextMessagesMax) break;
    const text = message.text
      .slice(0, DIRECT_CHAT_LIMITS.contextTextMax)
      .trim();
    if (!text) continue;
    if (
      aggregateChars + text.length >
      DIRECT_CHAT_LIMITS.contextCharsMax
    ) {
      continue;
    }
    aggregateChars += text.length;
    messages.push({
      messageId: message.messageId,
      senderUserId: message.senderUserId,
      sentAt: message.createdAt,
      text,
    });
  }

  const contextBundle = operatorContextBundleSchema.parse({ messages });
  return {
    contextBundle,
    ownIncluded: contextBundle.messages.some(
      (message) => message.senderUserId === input.actorUserId,
    ),
    peerIncluded: contextBundle.messages.some(
      (message) => message.senderUserId !== input.actorUserId,
    ),
  };
}

function queryTerms(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}_-]+/u)
      .map((term) => term.trim())
      .filter((term) => term.length >= 3),
  );
}

function lexicalScore(value: string, terms: ReadonlySet<string>): number {
  if (terms.size === 0) return 0;
  const normalized = value.toLocaleLowerCase();
  let score = 0;
  for (const term of terms) {
    if (normalized.includes(term)) score += 1;
  }
  return score;
}


export function boundDirectChatContextBefore(
  prepared: PreparedDirectChatContext,
  sourceCreatedAt: string,
  actorUserId: string,
): PreparedDirectChatContext {
  const sourceTime = Date.parse(sourceCreatedAt);
  if (!Number.isFinite(sourceTime)) {
    return {
      contextBundle: operatorContextBundleSchema.parse({ messages: [] }),
      ownIncluded: false,
      peerIncluded: false,
    };
  }
  const messages = prepared.contextBundle.messages.filter(
    (message) => {
      const sentAt = Date.parse(message.sentAt);
      return Number.isFinite(sentAt) && sentAt < sourceTime;
    },
  );
  const contextBundle = operatorContextBundleSchema.parse({ messages });
  return {
    contextBundle,
    ownIncluded: messages.some(
      (message) => message.senderUserId === actorUserId,
    ),
    peerIncluded: messages.some(
      (message) => message.senderUserId !== actorUserId,
    ),
  };
}
