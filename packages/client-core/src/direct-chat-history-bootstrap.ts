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
  if (!(allowZero ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/).test(value)) {
    throw new Error("Invalid Direct E2EE history sequence");
  }
  const sequence = BigInt(value);
  if (sequence > POSTGRES_BIGINT_MAX) {
    throw new Error("Invalid Direct E2EE history sequence");
  }
  return sequence;
}

/**
 * Pre-ratchet reconciliation gate. Every sequence from the newest fetched
 * row to an already-observed anchor must be present before decrypting any
 * incoming ciphertext. An indexed reaction hint older than an existing
 * anchor must reach a second known row *below* the hinted event. A server
 * that ends pagination early, skips rows, repeats a sequence under a new ID,
 * or withholds the required hinted ID cannot advance local ratchet state.
 *
 * This is a causal completeness check against the advertised server head,
 * NOT cryptographic proof that a malicious server has not withheld events
 * while lying consistently about its entire history.
 */
export function assertDirectHistoryGapComplete(input: {
  conversationId: string;
  advertisedHeadSequence: string;
  fetchedMessages: readonly DirectHistoryGapRow[];
  knownMessages: readonly DirectHistoryGapRow[];
  requiredMessageIds: readonly string[];
}): bigint {
  const advertisedHead = parseHistorySequence(input.advertisedHeadSequence, true);
  const knownById = new Map<string, bigint>();
  let newestKnown = 0n;
  for (const message of input.knownMessages) {
    if (message.conversationId !== input.conversationId) {
      throw new Error("Cross-conversation Direct E2EE history anchor");
    }
    const sequence = parseHistorySequence(message.sequence);
    const existing = knownById.get(message.id);
    if (existing !== undefined && existing !== sequence) {
      throw new Error("Conflicting Direct E2EE history anchor");
    }
    knownById.set(message.id, sequence);
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
    if ((previousSequence !== undefined && previousSequence !== sequence) ||
        (previousId !== undefined && previousId !== message.id) ||
        (knownById.has(message.id) && knownById.get(message.id) !== sequence)) {
      throw new Error("Conflicting Direct E2EE history page");
    }
    fetchedById.set(message.id, sequence);
    idBySequence.set(sequence, message.id);
    if (sequence > newestFetched) newestFetched = sequence;
  }
  if (newestFetched === 0n || newestFetched < advertisedHead ||
      newestFetched < newestKnown) {
    throw new Error("Incomplete Direct E2EE history head");
  }

  let oldestRequired: bigint | null = null;
  for (const messageId of input.requiredMessageIds) {
    const sequence = fetchedById.get(messageId);
    if (sequence === undefined) {
      throw new Error("Missing required Direct E2EE history event");
    }
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
  if (anchor === null) {
    throw new Error("Unanchored Direct E2EE history gap");
  }

  const verifiedAnchor = anchor;
  const ordered = [...idBySequence.keys()]
    .filter((sequence) => sequence >= verifiedAnchor)
    .sort((a, b) => a > b ? -1 : a < b ? 1 : 0);
  let expected = newestFetched;
  for (const sequence of ordered) {
    if (sequence !== expected) {
      throw new Error("Incomplete Direct E2EE history interval");
    }
    expected -= 1n;
  }
  if (expected !== anchor - 1n) {
    throw new Error("Incomplete Direct E2EE history interval");
  }
  return anchor;
}
