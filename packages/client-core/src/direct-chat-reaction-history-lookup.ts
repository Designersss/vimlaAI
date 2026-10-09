import type {
  DirectReactionEventsResponse,
} from "@vimla/contracts";

/**
 * Validate what a bounded opaque-tag index can honestly prove.
 *
 * This establishes response consistency ONLY. It never verifies the
 * sender's signed AD, original HUMAN provenance, complete ratchet interval
 * or historical emoji counts. The caller must not display reactions from
 * this sparse index response directly.
 */
export function validateDirectReactionLookupPage(
  result: DirectReactionEventsResponse,
  request: {
    conversationId: string;
    deviceId: string;
    targetTagB64: string;
    afterSequence: string;
    limit: number;
  },
): DirectReactionEventsResponse {
  if (!Number.isSafeInteger(request.limit) || request.limit < 1 ||
      request.limit > 50 ||
      !/^(0|[1-9][0-9]*)$/.test(request.afterSequence)) {
    throw new Error("Invalid E2EE reaction lookup parameters");
  }
  const after = BigInt(request.afterSequence);
  if (after > 9223372036854775807n ||
      result.items.length > request.limit ||
      (result.nextCursor !== null && (
        result.items.length !== request.limit ||
        result.nextCursor.length === 0 ||
        result.nextCursor.length > 512
      ))) {
    throw new Error("Inconsistent encrypted reaction history page");
  }
  const seenIds = new Set<string>();
  const seenSequences = new Set<string>();
  let lastSequence: bigint | null = null;
  for (const item of result.items) {
    if (!/^[1-9][0-9]*$/.test(item.sequence)) {
      throw new Error("Invalid encrypted reaction sequence");
    }
    const sequence = BigInt(item.sequence);
    if (sequence > 9223372036854775807n ||
        sequence <= after ||
        (lastSequence !== null && sequence >= lastSequence) ||
        item.conversationId !== request.conversationId ||
        item.kind !== "REACTION" ||
        item.reactionTargetTagB64 !== request.targetTagB64 ||
        (item.envelope !== null &&
          item.envelope.recipientDeviceId !== request.deviceId) ||
        seenIds.has(item.id) ||
        seenSequences.has(item.sequence)) {
      throw new Error("Conflicting or out-of-scope encrypted reaction history");
    }
    seenIds.add(item.id);
    seenSequences.add(item.sequence);
    lastSequence = sequence;
  }
  return result;
}
