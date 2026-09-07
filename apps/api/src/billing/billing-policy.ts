import type { ApiConfig } from "@vimla/config";
import type { BillingPolicy } from "@vimla/billing";

export function billingPolicyFromConfig(config: ApiConfig): BillingPolicy {
  return {
    minTopupMicroRub: BigInt(config.billingMinTopupMicroRub),
    maxTopupMicroRub: BigInt(config.billingMaxTopupMicroRub),
    topupProviderCostRatioBps: BigInt(config.billingTopupRatioBps),
    subscriptionPeriodDays: config.billingSubscriptionPeriodDays,
  };
}
