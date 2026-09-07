/**
 * Payment acquiring is behind this adapter. Domain code must not import a
 * specific processor SDK.
 */
export type { PaymentProvider } from "./payment-provider.js";

export const BILLING_FLOW = [
  "payment",
  "usage_bucket",
  "reservation",
  "ai_gateway",
  "provider",
  "actual_provider_cost",
  "settlement",
  "usage_ledger",
] as const;

export type BillingFlowStep = (typeof BILLING_FLOW)[number];
