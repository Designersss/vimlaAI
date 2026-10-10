export const DIRECT_HISTORY_CATCHUP_MAX_PAGES = 16;

/**
 * Restrict an event-gap reconciliation to a finite number of encrypted
 * history pages. A malicious/late hint, a very old missing checkpoint,
 * or a stale local cursor must not force full-conversation download.
 *
 * This is a safety bound, not a claim of complete historical recovery.
 * If the caller cannot reach an already-known event within the budget,
 * it must abort *before* decrypting an incomplete causal interval.
 */
export function assertDirectHistoryCatchupBudget(fetchedPages: number): void {
  if (!Number.isSafeInteger(fetchedPages) || fetchedPages < 0 ||
      fetchedPages >= DIRECT_HISTORY_CATCHUP_MAX_PAGES) {
    throw new Error("Direct E2EE history catch-up exceeds the safe page budget");
  }
}

export const DEEP_HISTORY_BOOTSTRAP_MAX_PAGES = 8;

export function shouldContinueDeepHistoryBootstrap(input: {
  cursor: string | null;
  missingSenderCount: number;
  backfillPages: number;
}): boolean {
  return (
    input.cursor !== null &&
    input.missingSenderCount > 0 &&
    input.backfillPages <
      DEEP_HISTORY_BOOTSTRAP_MAX_PAGES
  );
}

export function pageUnlocksHistoryBootstrap(input: {
  missingSenderDeviceIds: ReadonlySet<string>;
  messages: ReadonlyArray<{
    senderDeviceId: string;
    envelope: {
      x3dhInit: unknown | null;
    } | null;
  }>;
}): boolean {
  return input.messages.some(
    (message) =>
      input.missingSenderDeviceIds.has(
        message.senderDeviceId,
      ) &&
      message.envelope?.x3dhInit != null,
  );
}


/** Minimal immutable server metadata needed to preflight a Direct catch-up. */
interface DirectHistoryGapRow {
  id: string;
  conversationId: string;
  sequence: string;
}

const POSTGRES_BIGINT_MAX = 9223372036854775807n;

function parseHistorySequence(value: string, allowZero = false): bigint {
  if (!(allowZero ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/).test(value) ||
      value.length > 19) {
    throw new Error("Invalid Direct E2EE history sequence");
  }
  const sequence = BigInt(value);
  if (sequence > POSTGRES_BIGINT_MAX) {
    throw new Error("Invalid Direct E2EE history sequence");
  }
  return sequence;
}

/**
 * Inspect a bounded Direct realtime history window BEFORE ratchet operations.
 *
 * A hole or delayed page is NOT a cryptographic integrity failure:
 * authenticated Double Ratchet envelopes support skipped message keys, and
 * ordinary HUMAN messages must remain readable while an older send is in
 * flight or withheld. Only structural equivocation / invalid metadata throw.
 *
 * "complete" is a useful optimization for slicing an anchored interval,
 * NOT authorization to project reaction counts. Reaction state independently
 * requires a continuous server-head-to-HUMAN prefix and sender-authenticated
 * ciphertext, even when this inspection reports partial.
 */
export function inspectDirectHistoryGap(input: {
  conversationId: string;
  advertisedHeadSequence: string;
  fetchedMessages: readonly DirectHistoryGapRow[];
  knownMessages: readonly DirectHistoryGapRow[];
  requiredMessageIds: readonly string[];
}): { complete: true; anchor: bigint } | { complete: false } {
  const advertisedHead = parseHistorySequence(input.advertisedHeadSequence, true);
  const knownById = new Map<string, bigint>();
  const knownIdsBySequence = new Map<bigint, string>();
  let newestKnown = 0n;
  for (const message of input.knownMessages) {
    if (message.conversationId !== input.conversationId) {
      throw new Error("Cross-conversation Direct E2EE history anchor");
    }
    const sequence = parseHistorySequence(message.sequence);
    const previous = knownById.get(message.id);
    const previousId = knownIdsBySequence.get(sequence);
    if ((previous !== undefined && previous !== sequence) ||
        (previousId !== undefined && previousId !== message.id)) {
      throw new Error("Conflicting Direct E2EE history anchor");
    }
    knownById.set(message.id, sequence);
    knownIdsBySequence.set(sequence, message.id);
    if (sequence > newestKnown) newestKnown = sequence;
  }

  const fetchedById = new Map<string, bigint>();
  const idBySequence = new Map<bigint, string>();
  let newestFetched = 0n;
  for (const message of input.fetchedMessages) {
    if (message.conversationId !== input.conversationId) {
      throw new Error("Cross-conversation Direct E2EE history page");
    }
    const sequence = parseHistorySequence(message.sequence);
    const previousSequence = fetchedById.get(message.id);
    const previousId = idBySequence.get(sequence);
    const knownSequence = knownById.get(message.id);
    const knownId = knownIdsBySequence.get(sequence);
    if ((previousSequence !== undefined && previousSequence !== sequence) ||
        (previousId !== undefined && previousId !== message.id) ||
        (knownSequence !== undefined && knownSequence !== sequence) ||
        (knownId !== undefined && knownId !== message.id)) {
      throw new Error("Conflicting Direct E2EE history page");
    }
    fetchedById.set(message.id, sequence);
    idBySequence.set(sequence, message.id);
    if (sequence > newestFetched) newestFetched = sequence;
  }

  if (newestFetched === 0n || newestFetched < advertisedHead ||
      newestFetched < newestKnown) {
    return { complete: false };
  }

  let oldestRequired: bigint | null = null;
  for (const messageId of input.requiredMessageIds) {
    const sequence = fetchedById.get(messageId);
    if (sequence === undefined) return { complete: false };
    if (oldestRequired === null || sequence < oldestRequired) {
      oldestRequired = sequence;
    }
  }

  let anchor: bigint | null = null;
  for (const [id, sequence] of fetchedById) {
    if (knownById.get(id) !== sequence ||
        (oldestRequired !== null && sequence > oldestRequired)) continue;
    if (anchor === null || sequence > anchor) anchor = sequence;
  }
  if (anchor === null) return { complete: false };

  // Client-validated contiguous interval is a stronger property than merely
  // seeing a known row. Missing sequence numbers do not make otherwise
  // signed HUMAN messages invalid; they DO make reaction counts incomplete.
  const contiguousAnchor: bigint = anchor;
  const ordered = [...idBySequence.keys()]
    .filter((sequence) => sequence >= contiguousAnchor)
    .sort((a, b) => a > b ? -1 : a < b ? 1 : 0);
  let expected = newestFetched;
  for (const sequence of ordered) {
    if (sequence !== expected) return { complete: false };
    expected -= 1n;
  }
  return expected === contiguousAnchor - 1n
    ? { complete: true, anchor: contiguousAnchor }
    : { complete: false };
}
