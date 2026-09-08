/**
 * Authoritative monetary unit for Vimla domain/storage.
 * 1 RUB = 1_000_000 microRUB. Never use JavaScript number for money.
 */
export type MicroRub = bigint;

export const MICRORUB_PER_RUB = 1_000_000n;
export const KOPECKS_PER_RUB = 100n;
export const MICRORUB_PER_KOPECK = MICRORUB_PER_RUB / KOPECKS_PER_RUB;
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

export function microRubToKopecks(amount: MicroRub): bigint {
  if (amount < 0n) {
    throw new Error("Money amounts must be non-negative");
  }
  if (amount % MICRORUB_PER_KOPECK !== 0n) {
    throw new Error("Amount is not representable as whole kopecks");
  }
  return amount / MICRORUB_PER_KOPECK;
}

export function kopecksToMicroRub(kopecks: bigint): MicroRub {
  if (kopecks < 0n) {
    throw new Error("Kopeck amounts must be non-negative");
  }
  return kopecks * MICRORUB_PER_KOPECK;
}

/**
 * Conservative percentage-of-amount: round **up** to the next microRUB.
 * Used for estimated acquiring/fiscalization/tax costs so we never understate them.
 * Actual reconciled fees are stored as given and never recalculated.
 */
export function applyBpsCeil(amountMicroRub: MicroRub, bps: bigint): MicroRub {
  if (amountMicroRub < 0n || bps < 0n || bps > BASIS_POINTS_DENOMINATOR) {
    throw new Error("Invalid basis-point fee inputs");
  }
  if (amountMicroRub === 0n || bps === 0n) {
    return 0n;
  }
  const numerator = amountMicroRub * bps;
  return (numerator + BASIS_POINTS_DENOMINATOR - 1n) / BASIS_POINTS_DENOMINATOR;
}

export function marginBpsFloor(contributionMicroRub: MicroRub, netSalesMicroRub: MicroRub): number | null {
  if (netSalesMicroRub <= 0n) {
    return null;
  }
  return Number((contributionMicroRub * BASIS_POINTS_DENOMINATOR) / netSalesMicroRub);
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
