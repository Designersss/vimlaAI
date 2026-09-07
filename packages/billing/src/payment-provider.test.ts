import { describe, expect, it } from "vitest";
import { MOCK_PAYMENT_PROVIDER_ID, MockPaymentProvider } from "./payment-provider.js";

describe("MockPaymentProvider", () => {
  it("refuses construction when disabled", () => {
    expect(() => new MockPaymentProvider(false)).toThrow(/cannot be constructed/);
  });

  it("emits stable event ids so retries replay as duplicates", () => {
    const provider = new MockPaymentProvider(true);
    const { providerPaymentId } = provider.createPayment("SUBSCRIPTION");
    const first = provider.succeed(providerPaymentId);
    const second = provider.succeed(providerPaymentId);
    expect(first.provider).toBe(MOCK_PAYMENT_PROVIDER_ID);
    expect(first.providerEventId).toBe(second.providerEventId);
  });
});
