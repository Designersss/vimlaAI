/**
 * Authoritative monetary unit for Vimla domain/storage.
 * 1 RUB = 1_000_000 microRUB. Never use JavaScript number for money.
 */
export type MicroRub = bigint;

export const MICRORUB_PER_RUB = 1_000_000n;
export const BASIS_POINTS_DENOMINATOR = 10_000n;

const INTEGER_STRING_PATTERN = /^-?\d+$/;

export function microRubToJson(value: MicroRub): string {
  return value.toString(10);
}

export function microRubFromJson(value: string): MicroRub {
  const trimmed = value.trim();
  if (!INTEGER_STRING_PATTERN.test(trimmed)) {
    throw new Error("Invalid microRUB JSON value");
  }

  return BigInt(trimmed);
}

export function rubToMicroRub(rub: bigint): MicroRub {
  if (rub < 0n) {
    throw new Error("Ruble amounts must be non-negative");
  }

  return rub * MICRORUB_PER_RUB;
}

export function availableMicroRub(
  total: MicroRub,
  spent: MicroRub,
  reserved: MicroRub,
): MicroRub {
  return total - spent - reserved;
}

/**
 * Top-up provider budget uses integer floor division.
 * Example: 1000 RUB * 3500 bps / 10000 = 350 RUB exactly.
 * Remainders below 1 microRUB are discarded; Vimla never rounds up.
 */
export function topupProviderBudgetMicroRub(
  amountMicroRub: MicroRub,
  ratioBps: bigint,
): MicroRub {
  if (amountMicroRub < 0n || ratioBps < 0n || ratioBps > BASIS_POINTS_DENOMINATOR) {
    throw new Error("Invalid top-up budget inputs");
  }

  return (amountMicroRub * ratioBps) / BASIS_POINTS_DENOMINATOR;
}

export function usedPercentFloor(committed: MicroRub, total: MicroRub): number {
  if (total <= 0n) {
    return 0;
  }

  const percent = (committed * 100n) / total;
  if (percent > 100n) {
    return 100;
  }

  return Number(percent);
}
