/**
 * Keep the authoritative Direct stream high-water mark monotonic when an
 * acknowledged local send races a previously fetched conversation detail.
 *
 * The server allocates the sequence in PostgreSQL. JS Number would silently
 * round it above 2^53, so only canonical decimal bigint strings are accepted.
 */
export function advanceDirectHistoryHead(
  currentSequence: string,
  acknowledgedSequence: string,
): string {
  const parse = (value: string): bigint => {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) {
      throw new Error("Invalid Direct sequence metadata");
    }
    const sequence = BigInt(value);
    if (sequence > 9223372036854775807n) {
      throw new Error("Direct sequence exceeds PostgreSQL bigint");
    }
    return sequence;
  };
  const current = parse(currentSequence);
  const acknowledged = parse(acknowledgedSequence);
  return (current > acknowledged ? current : acknowledged).toString();
}

/**
 * Responses can arrive after newer local acknowledgements or realtime
 * refreshes. The incoming detail controls current permissions/privacy,
 * while the database's append-only history high-water must never rewind.
 * A different conversation never inherits another chat's watermark.
 */
export function reconcileDirectHistoryHead<
  T extends { id: string; lastMessageSequence: string },
>(current: T | null, incoming: T): T {
  return current?.id === incoming.id
    ? {
        ...incoming,
        lastMessageSequence: advanceDirectHistoryHead(
          current.lastMessageSequence, incoming.lastMessageSequence,
        ),
      }
    : incoming;
}

/**
 * A privacy mutation acknowledges only the fields that were submitted.
 * Its response can race later reaction sends, an unrelated privacy toggle,
 * a trust block, or navigation to a different Direct chat. Preserve all
 * newer unrelated state while still admitting a newer server stream head.
 */
export function applyDirectPrivacyAcknowledgement<
  T extends {
    id: string;
    lastMessageSequence: string;
    privacy: {
      shareOwnHistoryWithVimla: boolean;
      includePeerHistoryWhenInvoking: boolean;
    };
  },
>(
  current: T | null,
  acknowledgement: T,
  submitted: {
    shareOwnHistoryWithVimla?: boolean;
    includePeerHistoryWhenInvoking?: boolean;
  },
): T | null {
  if (!current || current.id !== acknowledgement.id) return current;
  return {
    ...current,
    lastMessageSequence: advanceDirectHistoryHead(
      current.lastMessageSequence,
      acknowledgement.lastMessageSequence,
    ),
    privacy: {
      ...current.privacy,
      ...submitted,
    },
  };
}
