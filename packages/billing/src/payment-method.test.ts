import { describe, expect, it } from "vitest";
import { normalizePaymentMethod } from "./payment-method.js";

describe("payment method normalization", () => {
  it("treats a signed PAN as CARD without keeping the PAN", () => {
    expect(normalizePaymentMethod({ signedPanPresent: true })).toEqual({
      paymentMethod: "CARD",
      raw: "pan",
    });
  });

  it("maps trusted GetState Source values", () => {
    expect(normalizePaymentMethod({ getStateSource: "sbp" }).paymentMethod).toBe("SBP");
    expect(normalizePaymentMethod({ getStateSource: "TinkoffPay" }).paymentMethod).toBe("T_PAY");
    expect(normalizePaymentMethod({}).paymentMethod).toBe("UNKNOWN");
  });
});
