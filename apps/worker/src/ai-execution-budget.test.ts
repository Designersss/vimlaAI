import { describe, expect, it } from "vitest";
import {
  resolveAiExecutionBudget,
  type AiExecutionBudgetProfiles,
} from "./ai-execution-budget.js";

const profiles: AiExecutionBudgetProfiles = {
  SHORT: {
    preferredOutputTokens: 512,
    minimumOutputTokens: 128,
  },
  STANDARD: {
    preferredOutputTokens: 2_048,
    minimumOutputTokens: 768,
  },
  LONG: {
    preferredOutputTokens: 4_096,
    minimumOutputTokens: 2_048,
  },
};

const price = {
  inputMicroRubPerMillion: 1_000_000n,
  outputMicroRubPerMillion: 1_000_000n,
  cacheReadMicroRubPerMillion: null,
  cacheWriteMicroRubPerMillion: null,
};

describe("resolveAiExecutionBudget", () => {
  it("uses the preferred output budget when it is fully funded", () => {
    const result = resolveAiExecutionBudget({
      profile: "STANDARD",
      profiles,
      modelMaxOutputTokens: 16_384,
      estimatedInputTokens: 100,
      availableMicroRub: 10_000n,
      maxReservationMicroRub: 20_000n,
      price,
      safetyBps: 0n,
    });

    expect(result).toEqual({
      kind: "FUNDED",
      budget: {
        profile: "STANDARD",
        preferredOutputTokens: 2_048,
        minimumOutputTokens: 768,
        selectedOutputTokens: 2_048,
        estimatedCostMicroRub: 2_148n,
      },
    });
  });

  it("shrinks to the largest output cap that fits remaining allowance", () => {
    const result = resolveAiExecutionBudget({
      profile: "STANDARD",
      profiles,
      modelMaxOutputTokens: 16_384,
      estimatedInputTokens: 100,
      availableMicroRub: 1_000n,
      maxReservationMicroRub: 20_000n,
      price,
      safetyBps: 0n,
    });

    expect(result).toEqual({
      kind: "FUNDED",
      budget: {
        profile: "STANDARD",
        preferredOutputTokens: 2_048,
        minimumOutputTokens: 768,
        selectedOutputTokens: 900,
        estimatedCostMicroRub: 1_000n,
      },
    });
  });

  it("blocks when remaining allowance cannot fund the minimum useful output", () => {
    const result = resolveAiExecutionBudget({
      profile: "STANDARD",
      profiles,
      modelMaxOutputTokens: 16_384,
      estimatedInputTokens: 100,
      availableMicroRub: 800n,
      maxReservationMicroRub: 20_000n,
      price,
      safetyBps: 0n,
    });

    expect(result).toEqual({ kind: "INSUFFICIENT_USAGE" });
  });

  it("distinguishes the per-request hard cost ceiling from user allowance", () => {
    const result = resolveAiExecutionBudget({
      profile: "STANDARD",
      profiles,
      modelMaxOutputTokens: 16_384,
      estimatedInputTokens: 100,
      availableMicroRub: 20_000n,
      maxReservationMicroRub: 800n,
      price,
      safetyBps: 0n,
    });

    expect(result).toEqual({ kind: "REQUEST_COST_LIMIT" });
  });
});
