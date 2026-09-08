import { describe, expect, it } from "vitest";
import { chooseFee, estimateAcquiringFee } from "./fee-estimate.js";
import { assessGuardrail, simulateTariffEconomics } from "./tariff-simulator.js";
import { rubToMicroRub } from "./money.js";

describe("fee estimates", () => {
  it("never adds actual and estimated fees together", () => {
    expect(chooseFee(10n, 4n)).toEqual({ amount: 10n, quality: "ACTUAL" });
    expect(chooseFee(null, 4n)).toEqual({ amount: 4n, quality: "ESTIMATED" });
    expect(chooseFee(null, null)).toEqual({ amount: 0n, quality: "UNKNOWN" });
  });

  it("applies minimum fee after the percentage", () => {
    const estimated = estimateAcquiringFee(rubToMicroRub(1n), {
      feeBps: 100n,
      feeVatBps: 0n,
      minimumFeeMicroRub: rubToMicroRub(10n),
      fixedFeeMicroRub: null,
    });
    expect(estimated.feeMicroRub).toBe(rubToMicroRub(10n));
  });
});

describe("tariff simulator", () => {
  it("marks a negative conservative margin and picks the worst payment method", () => {
    const result = simulateTariffEconomics({
      priceMicroRub: rubToMicroRub(199n),
      monthlyUsageGrantMicroRub: rubToMicroRub(180n),
      paymentFees: {
        CARD: { feeBps: 2500n, feeVatBps: 2000n, minimumFeeMicroRub: null, fixedFeeMicroRub: null },
        SBP: { feeBps: 400n, feeVatBps: 0n, minimumFeeMicroRub: null, fixedFeeMicroRub: null },
      },
      targetMinimumMarginBps: 2000,
    });
    expect(result.methods).toHaveLength(2);
    expect(result.worstCase?.paymentMethod).toBe("CARD");
    expect(result.worstCase?.guardrail).toBe("NEGATIVE");
    expect(assessGuardrail(500, 2000)).toBe("WARNING");
    expect(assessGuardrail(2000, 2000)).toBe("SAFE");
  });

  it("does not invent a method that has no configured policy", () => {
    const result = simulateTariffEconomics({
      priceMicroRub: rubToMicroRub(199n),
      monthlyUsageGrantMicroRub: rubToMicroRub(50n),
      paymentFees: {
        SBP: { feeBps: 400n, feeVatBps: 0n, minimumFeeMicroRub: null, fixedFeeMicroRub: null },
      },
    });
    expect(result.methods.map((item) => item.paymentMethod)).toEqual(["SBP"]);
  });
});
