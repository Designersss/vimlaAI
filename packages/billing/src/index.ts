export { BillingEngine } from "./billing-engine.js";
export { BillingError, BILLING_ERROR_CODES, isBillingError, type BillingErrorCode } from "./errors.js";
export {
  availableMicroRub,
  BASIS_POINTS_DENOMINATOR,
  KOPECKS_PER_RUB,
  MICRORUB_PER_KOPECK,
  MICRORUB_PER_RUB,
  kopecksToMicroRub,
  microRubFromJson,
  microRubToJson,
  microRubToKopecks,
  rubToMicroRub,
  topupProviderBudgetMicroRub,
  usedPercentFloor,
  applyBpsCeil,
  marginBpsFloor,
  type MicroRub,
} from "./money.js";
export {
  DEFAULT_BILLING_POLICY,
  isDevBillingEnvironment,
  validateTopupAmount,
} from "./policy.js";
export { planCatalogByCode, VIMLA_PLAN_CATALOG } from "./plan-catalog.js";
export { compareBucketPriority, planReservationAllocations } from "./allocation.js";
export {
  PLAN_ENTITLEMENT_KEYS,
  CANONICAL_PROJECT_ENTITLEMENT_KEYS,
  DEPRECATED_PROJECT_ENTITLEMENT_KEYS,
  assertKnownEntitlementKey,
  assertWritableEntitlementKey,
  decodeEntitlement,
  encodeEntitlement,
  isDeprecatedProjectEntitlementKey,
  isTopupAllowed,
  type PlanEntitlementKey,
  type PlanEntitlementRecord,
  type EntitlementValue,
} from "./entitlements.js";
export { EffectivePlanResolver, FREE_PLAN_CODE } from "./effective-plan.js";
export { FinanceQueryService } from "./finance-query.js";
export type {
  FinanceOverview,
  FinanceQueryFilter,
  CohortEconomics,
  UsageUtilization,
  UsageSplit,
  PaymentMethodAnalyticsRow,
  ModelEconomicsRow,
  FinanceTimeseriesPoint,
} from "./finance-types.js";
export { simulateTariffEconomics, assessGuardrail, type TariffSimulationAssumptions, type TariffSimulationResult } from "./tariff-simulator.js";
export { chooseFee, estimateAcquiringFee, estimateFiscalizationFee, type AcquiringFeePolicy, type FiscalizationFeePolicy } from "./fee-estimate.js";
export { normalizePaymentMethod } from "./payment-method.js";
export {
  MOCK_PAYMENT_PROVIDER_ID,
  MockPaymentProvider,
  type HostedCheckoutInput,
  type HostedCheckoutResult,
  type MockPaymentEvent,
  type PaymentProvider,
  type ProviderPaymentState,
} from "./payment-provider.js";
export {
  DEFAULT_TBANK_API_BASE_URL,
  MockTBankTransport,
  TBANK_PAYMENT_PROVIDER_ID,
  TBankHttpTransport,
  TBankPaymentProvider,
  isConfirmedProviderStatus,
  verifyTBankNotification,
  type TBankFiscalizationConfig,
  type TBankProviderConfig,
  type TBankTransport,
  type VerifiedTBankNotification,
} from "./tbank-provider.js";
export { canonicalTokenString, signTBankToken, verifyTBankToken } from "./tbank-token.js";
export {
  PaymentService,
  type PaymentCheckoutUrls,
  type PaymentVerifierConfig,
  type PublicPaymentView,
} from "./payment-service.js";
export { PaymentMetrics, type PaymentMetricsSnapshot } from "./payment-metrics.js";
export { billingSubjectForActor, parseCheckoutSnapshot, toCheckoutSnapshotJson } from "./billing-subject.js";
export {
  classifyTBankStatus,
  isPaidDomainStatus,
  nextDomainStatus,
  TBANK_PAYMENT_STATUSES,
} from "./payment-states.js";
export { paymentEventFromNotification, tbankNotificationFingerprint } from "./payment-events.js";
export { seedVimlaPlans } from "./seed-plans.js";
export { simulateProviderUsage } from "./simulate-provider-usage.js";
export type {
  ActiveSubscriptionView,
  BillingLogger,
  BillingPolicy,
  PaymentKind,
  PaymentStatus,
  PlanCode,
  PlanIdentityCode,
  ProcessPaymentResult,
  ReservationView,
  RetailPlan,
  UsageSnapshot,
} from "./types.js";
export { TariffAdminService, type DraftPlanInput, type PublishConfirmation } from "./tariff-admin.js";
export { PolicyAdminService } from "./policy-admin.js";
export { BILLING_FLOW, type BillingFlowStep } from "./domain.js";
