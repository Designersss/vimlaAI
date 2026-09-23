/**
 * Context admission intentionally treats one UTF-8 byte as one conservative
 * token unit. This overestimates many real tokenizers but never undercounts
 * multilingual input for budget/compaction safety.
 */
export function estimateConservativeTokens(
  value: string,
): number {
  return Math.max(
    1,
    new TextEncoder().encode(value).byteLength,
  );
}

export function conservativeTokensFromByteCount(
  byteCount: bigint,
): number {
  if (byteCount <= 0n) return 0;
  return byteCount > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(byteCount);
}
