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
