import { describe, expect, it } from "vitest";
import {
  mockSubscriptionPurchaseSchema,
  mockTopupPurchaseSchema,
  plansResponseSchema,
  usageResponseSchema,
} from "./billing.js";

describe("usageResponseSchema", () => {
  it("accepts decimal-string money and a derived percent", () => {
    const parsed = usageResponseSchema.parse({
      monthly: {
        totalMicroRub: "297000000",
        spentMicroRub: "100000000",
        reservedMicroRub: "5000000",
        remainingMicroRub: "192000000",
        usedPercent: 35,
      },
      topup: {
        totalMicroRub: "350000000",
        spentMicroRub: "0",
        reservedMicroRub: "0",
        remainingMicroRub: "350000000",
        usedPercent: 0,
      },
    });
    expect(parsed.monthly.usedPercent).toBe(35);
  });
});

describe("plansResponseSchema", () => {
  it("does not require provider budget fields", () => {
    const parsed = plansResponseSchema.parse({
      plans: [{ code: "PRO", name: "Pro", priceMicroRub: "990000000" }],
    });
    expect(parsed.plans[0]?.code).toBe("PRO");
  });
});

describe("financial mutating DTOs", () => {
  it("rejects unexpected userId and provider fields", () => {
    expect(
      mockSubscriptionPurchaseSchema.safeParse({
        planCode: "PRO",
        userId: "another-user",
      }).success,
    ).toBe(false);

    expect(
      mockTopupPurchaseSchema.safeParse({
        amountMicroRub: "1000000000",
        providerBudget: "1",
        actualCost: "1",
      }).success,
    ).toBe(false);
  });
});

describe("checkout DTOs", () => {
  it("rejects browser-supplied price, userId and grant fields", async () => {
    const { subscriptionCheckoutSchema, topupCheckoutSchema } = await import("./billing.js");
    expect(
      subscriptionCheckoutSchema.safeParse({
        planCode: "PRO",
        idempotencyKey: "00000000-0000-4000-8000-000000000000",
        price: 1,
        userId: "other",
        providerBudget: 999999,
      }).success,
    ).toBe(false);
    expect(
      topupCheckoutSchema.safeParse({
        amountMicroRub: "1000000000",
        idempotencyKey: "00000000-0000-4000-8000-000000000000",
        providerUsageGrant: "1",
        ratioBps: "1",
      }).success,
    ).toBe(false);
  });
});
