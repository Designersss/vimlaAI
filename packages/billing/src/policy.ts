import { BASIS_POINTS_DENOMINATOR, rubToMicroRub, type MicroRub } from "./money.js";
import { BillingError } from "./errors.js";
import type { BillingPolicy } from "./types.js";

export const DEFAULT_BILLING_POLICY: BillingPolicy = {
  minTopupMicroRub: rubToMicroRub(100n),
  maxTopupMicroRub: rubToMicroRub(100_000n),
  topupProviderCostRatioBps: 3500n,
  subscriptionPeriodDays: 30,
};

export function validateTopupAmount(
  amountMicroRub: MicroRub,
  policy: BillingPolicy,
): void {
  if (amountMicroRub <= 0n) {
    throw new BillingError("INVALID_TOPUP_AMOUNT", "Top-up amount must be greater than zero");
  }

  if (amountMicroRub < policy.minTopupMicroRub) {
    throw new BillingError("INVALID_TOPUP_AMOUNT", "Top-up amount is below the minimum");
  }

  if (amountMicroRub > policy.maxTopupMicroRub) {
    throw new BillingError("INVALID_TOPUP_AMOUNT", "Top-up amount is above the maximum");
  }
}

export function assertPolicy(policy: BillingPolicy): void {
  if (policy.minTopupMicroRub <= 0n || policy.maxTopupMicroRub < policy.minTopupMicroRub) {
    throw new BillingError("FINANCIAL_OPERATION_FAILED", "Invalid top-up bounds");
  }

  if (
    policy.topupProviderCostRatioBps < 0n ||
    policy.topupProviderCostRatioBps > BASIS_POINTS_DENOMINATOR
  ) {
    throw new BillingError("FINANCIAL_OPERATION_FAILED", "Invalid top-up ratio");
  }

  if (policy.subscriptionPeriodDays <= 0 || policy.subscriptionPeriodDays > 366) {
    throw new BillingError("FINANCIAL_OPERATION_FAILED", "Invalid subscription period");
  }
}

export function isDevBillingEnvironment(appEnv: string): boolean {
  return appEnv === "local" || appEnv === "test";
}
