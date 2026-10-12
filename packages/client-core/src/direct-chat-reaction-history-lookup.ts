import type {
  DirectReactionEventsResponse,
} from "@vimla/contracts";

/**
 * Validate what a bounded opaque-tag index can honestly prove.
 *
 * The sourceSequence is held only on the client and is NEVER transmitted
 * to the indexed API (doing so would reveal the opaque tag target).
 * This establishes response consistency ONLY. It never verifies the
 * sender's signed AD, original HUMAN provenance, complete ratchet interval
 * or historical emoji counts. The caller must not display reactions from
 * this sparse index response directly.
 */
/**
 * Canonical portable encoding of the versioned server sequence cursor.
 * Its s1:decimal wire form is a public paging protocol, not a signature.
 * Avoid Buffer/btoa so Desktop/Mobile share the same validation policy.
 */
function expectedDirectSequenceCursor(sequence: string): string {
  const raw = `s1:${sequence}`;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let encoded = "";
  for (let offset = 0; offset < raw.length; offset += 3) {
    const first = raw.charCodeAt(offset);
    const second = offset + 1 < raw.length ? raw.charCodeAt(offset + 1) : 0;
    const third = offset + 2 < raw.length ? raw.charCodeAt(offset + 2) : 0;
    encoded += alphabet[(first >>> 2) & 63];
    encoded += alphabet[((first & 3) << 4) | (second >>> 4)];
    if (offset + 1 < raw.length) {
      encoded += alphabet[((second & 15) << 2) | (third >>> 6)];
    }
    if (offset + 2 < raw.length) {
      encoded += alphabet[third & 63];
    }
  }
  return encoded;
}

export function validateDirectReactionLookupPage(
  result: DirectReactionEventsResponse,
  request: {
    conversationId: string;
    deviceId: string;
    targetTagB64: string;
    sourceSequence: string;
    limit: number;
  },
): DirectReactionEventsResponse {
  if (!Number.isSafeInteger(request.limit) || request.limit < 1 ||
      request.limit > 50 ||
      request.sourceSequence.length > 19 ||
      !/^(0|[1-9][0-9]*)$/.test(request.sourceSequence)) {
    throw new Error("Invalid E2EE reaction lookup parameters");
  }
  const after = BigInt(request.sourceSequence);
  if (after > 9223372036854775807n ||
      result.items.length > request.limit ||
      (result.nextCursor !== null && (
        result.items.length !== request.limit ||
        result.nextCursor.length === 0 ||
        result.nextCursor.length > 64
      ))) {
    throw new Error("Inconsistent encrypted reaction history page");
  }
  const seenIds = new Set<string>();
  const seenSequences = new Set<string>();
  let lastSequence: bigint | null = null;
  for (const item of result.items) {
    if (item.sequence.length > 19 || !/^[1-9][0-9]*$/.test(item.sequence)) {
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
  // A corrupt cursor can silently skip or repeat E2EE controls. Bind every
  // nonterminal page to the last returned sequence, exactly as the server's
  // canonical s1 cursor encoder does; this still cannot prove that the
  // server returned *all* matching events.
  if (result.nextCursor !== null &&
      (lastSequence === null ||
        result.nextCursor !== expectedDirectSequenceCursor(lastSequence.toString()))) {
    throw new Error("Inconsistent encrypted reaction history cursor");
  }
  return result;
}
