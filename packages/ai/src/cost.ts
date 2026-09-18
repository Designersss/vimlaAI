import { MICRORUB_PER_RUB, type MicroRub } from "@vimla/billing";
import { AiError } from "./errors.js";
import type { NormalizedUsage, PriceVersionQuote } from "./types.js";

export const TOKENS_PER_MILLION = 1_000_000n;

/**
 * Ceiling integer cost so Vimla never under-accounts provider COGS.
 * cost = ceil(tokens * priceMicroRubPerMillion / 1_000_000)
 */
export function tokenCostMicroRub(
  tokens: bigint,
  priceMicroRubPerMillion: MicroRub,
): MicroRub {
  if (tokens < 0n || priceMicroRubPerMillion < 0n) {
    throw new AiError("PROVIDER_USAGE_INVALID", "Token cost inputs must be non-negative", 500);
  }

  if (tokens === 0n || priceMicroRubPerMillion === 0n) {
    return 0n;
  }

  return (tokens * priceMicroRubPerMillion + TOKENS_PER_MILLION - 1n) / TOKENS_PER_MILLION;
}

export function applySafetyMargin(
  costMicroRub: MicroRub,
  safetyBps: bigint,
): MicroRub {
  if (costMicroRub < 0n || safetyBps < 0n) {
    throw new AiError("PROVIDER_USAGE_INVALID", "Safety margin inputs must be non-negative", 500);
  }

  return (costMicroRub * (10_000n + safetyBps) + 9_999n) / 10_000n;
}

export function providerCostFromUsage(
  usage: NormalizedUsage,
  price: PriceVersionQuote,
): MicroRub {
  const uncachedInput = usage.inputTokens - usage.cacheReadTokens;
  if (uncachedInput < 0n) {
    throw new AiError(
      "PROVIDER_USAGE_INVALID",
      "cacheReadTokens cannot exceed inputTokens",
      500,
    );
  }

  let total = tokenCostMicroRub(uncachedInput, price.inputMicroRubPerMillion);
  total += tokenCostMicroRub(usage.outputTokens, price.outputMicroRubPerMillion);

  if (usage.cacheReadTokens > 0n) {
    total += tokenCostMicroRub(
      usage.cacheReadTokens,
      price.cacheReadMicroRubPerMillion ?? 0n,
    );
  }

  if (usage.cacheWriteTokens > 0n) {
    total += tokenCostMicroRub(
      usage.cacheWriteTokens,
      price.cacheWriteMicroRubPerMillion ?? 0n,
    );
  }

  return total;
}

export function estimateReservationMicroRub(input: {
  estimatedInputTokens: bigint;
  maxOutputTokens: bigint;
  price: PriceVersionQuote;
  safetyBps: bigint;
}): MicroRub {
  const cacheReadPrice = input.price.cacheReadMicroRubPerMillion ?? 0n;
  const cacheWritePrice = input.price.cacheWriteMicroRubPerMillion ?? 0n;
  const baseInputPrice =
    input.price.inputMicroRubPerMillion > cacheReadPrice
      ? input.price.inputMicroRubPerMillion
      : cacheReadPrice;

  // Cache-write accounting can be additive to ordinary/cached input accounting.
  // Reserve the conservative upper bound for every estimated input token.
  const worstCaseInputPrice = baseInputPrice + cacheWritePrice;
  const raw =
    tokenCostMicroRub(input.estimatedInputTokens, worstCaseInputPrice) +
    tokenCostMicroRub(input.maxOutputTokens, input.price.outputMicroRubPerMillion);
  const reserved = applySafetyMargin(raw, input.safetyBps);
  return reserved < 1n ? 1n : reserved;
}

export function rubPerMillionToMicroRub(rub: bigint): MicroRub {
  return rub * MICRORUB_PER_RUB;
}
