/**
 * Select fair, bounded GC candidates. Fixed oldest-first slices can starve
 * later records whenever early commits remain ambiguous. A time-window
 * cursor is stable across reloads without new E2EE storage dependencies.
 */
export const TRUST_CANCELLED_GC_MIN_AGE_MS = 5 * 60_000;
export const TRUST_CANCELLED_GC_POLL_INTERVAL_MS = 5 * 60_000;
export const TRUST_CANCELLED_GC_BATCH_MAX = 16;

export interface TrustCancelledGcRow {
  conversationId: string;
  senderDeviceId: string;
  clientMessageId: string;
  createdAt: string;
  trustCancelledAt?: string;
  operatorIntent?: unknown;
}

export function selectTrustCancelledGcCandidates<T extends TrustCancelledGcRow>(
  rows: readonly T[],
  input: { conversationId: string; senderDeviceId: string; now: number },
): T[] {
  const candidates = rows.filter((row) => {
    const cancelledAt = row.trustCancelledAt
      ? Date.parse(row.trustCancelledAt)
      : Number.NaN;
    return (
      row.conversationId === input.conversationId &&
      row.senderDeviceId === input.senderDeviceId &&
      Number.isFinite(cancelledAt) &&
      cancelledAt <= input.now &&
      input.now - cancelledAt >= TRUST_CANCELLED_GC_MIN_AGE_MS
    );
  }).sort((left, right) =>
    Number(Boolean(left.operatorIntent)) -
      Number(Boolean(right.operatorIntent)) ||
    Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
    left.clientMessageId.localeCompare(right.clientMessageId),
  );
  if (candidates.length <= TRUST_CANCELLED_GC_BATCH_MAX) {
    return candidates;
  }

  const pages = Math.ceil(candidates.length / TRUST_CANCELLED_GC_BATCH_MAX);
  const epoch = Math.floor(input.now / TRUST_CANCELLED_GC_POLL_INTERVAL_MS);
  const start = (epoch % pages) * TRUST_CANCELLED_GC_BATCH_MAX;
  return candidates.slice(start, start + TRUST_CANCELLED_GC_BATCH_MAX);
}
