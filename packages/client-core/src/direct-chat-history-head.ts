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
