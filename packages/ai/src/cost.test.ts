import { describe, expect, it } from "vitest";
import { MICRORUB_PER_RUB } from "@vimla/billing";
import { applySafetyMargin, providerCostFromUsage, tokenCostMicroRub } from "./cost.js";
import { normalizeProviderUsage } from "./usage.js";

describe("tokenCostMicroRub", () => {
  it("uses bigint ceiling division", () => {
    expect(tokenCostMicroRub(1n, 60n * MICRORUB_PER_RUB)).toBe(60n);
    expect(tokenCostMicroRub(1_000_000n, 60n * MICRORUB_PER_RUB)).toBe(60n * MICRORUB_PER_RUB);
  });

  it("never uses number arithmetic", () => {
    const cost = tokenCostMicroRub(3n, 91n * MICRORUB_PER_RUB);
    expect(typeof cost).toBe("bigint");
  });
});

describe("providerCostFromUsage", () => {
  const price = {
    inputMicroRubPerMillion: 60n * MICRORUB_PER_RUB,
    outputMicroRubPerMillion: 360n * MICRORUB_PER_RUB,
    cacheReadMicroRubPerMillion: 6n * MICRORUB_PER_RUB,
    cacheWriteMicroRubPerMillion: 75n * MICRORUB_PER_RUB,
  };

  it("does not double-bill cached input or reasoning tokens", () => {
    const usage = normalizeProviderUsage({
      inputTokens: 100n,
      outputTokens: 50n,
      reasoningTokens: 10n,
      cacheReadTokens: 40n,
      cacheWriteTokens: 5n,
    });

    const cost = providerCostFromUsage(usage, price);
    const expected =
      tokenCostMicroRub(60n, price.inputMicroRubPerMillion) +
      tokenCostMicroRub(50n, price.outputMicroRubPerMillion) +
      tokenCostMicroRub(40n, price.cacheReadMicroRubPerMillion ?? 0n) +
      tokenCostMicroRub(5n, price.cacheWriteMicroRubPerMillion ?? 0n);
    expect(cost).toBe(expected);
  });
});

describe("applySafetyMargin", () => {
  it("adds basis points with ceiling", () => {
    expect(applySafetyMargin(10_000_000n, 2000n)).toBe(12_000_000n);
  });
});
