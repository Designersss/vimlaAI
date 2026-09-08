import type { MicroRub } from "./money.js";

export type FinanceQuality = "ACTUAL" | "ESTIMATED" | "PARTIAL" | "UNKNOWN" | "INSUFFICIENT_DATA";

export interface FinanceOverview {
  grossRevenueMicroRub: MicroRub;
  refundsMicroRub: MicroRub;
  chargebackAmountMicroRub: MicroRub;
  netSalesMicroRub: MicroRub;
  estimatedPaymentFeesMicroRub: MicroRub;
  actualPaymentFeesMicroRub: MicroRub;
  usedPaymentFeesMicroRub: MicroRub;
  estimatedFiscalizationFeesMicroRub: MicroRub;
  actualFiscalizationFeesMicroRub: MicroRub;
  usedFiscalizationFeesMicroRub: MicroRub;
  realizedAiCogsMicroRub: MicroRub;
  knownVariableCostsMicroRub: MicroRub;
  outstandingMonthlyUsageMicroRub: MicroRub;
  outstandingTopupUsageMicroRub: MicroRub;
  totalOutstandingUsageMicroRub: MicroRub;
  expiredMonthlyUsageMicroRub: MicroRub;
  estimatedTaxReserveMicroRub: MicroRub | null;
  realizedContributionMicroRub: MicroRub;
  conservativeContributionMicroRub: MicroRub;
  realizedMarginBps: number | null;
  conservativeMarginBps: number | null;
  paymentFeeQuality: FinanceQuality;
  fiscalizationFeeQuality: FinanceQuality;
  overallQuality: FinanceQuality;
  expectedMarginBps: number | null;
  expectedMarginQuality: FinanceQuality;
}

export interface UsageUtilization {
  grantMicroRub: MicroRub;
  consumedMicroRub: MicroRub;
  remainingMicroRub: MicroRub;
  expiredUnusedMicroRub: MicroRub;
  utilizationPercent: number | null;
}

export interface FinanceQueryFilter {
  from?: Date;
  to?: Date;
  planVersionId?: string;
  paymentKind?: "SUBSCRIPTION" | "TOPUP";
  userId?: string;
}

export interface CohortEconomics extends FinanceOverview {
  planVersionId: string | null;
  paymentKind: "SUBSCRIPTION" | "TOPUP" | null;
  utilization: UsageUtilization;
}

export interface UsageSplit {
  monthlyGrantedMicroRub: MicroRub;
  monthlyConsumedMicroRub: MicroRub;
  monthlyExpiredUnusedMicroRub: MicroRub;
  topupGrantedMicroRub: MicroRub;
  topupConsumedMicroRub: MicroRub;
  topupOutstandingMicroRub: MicroRub;
}

export interface PaymentMethodAnalyticsRow {
  paymentMethod: string;
  paymentCount: number;
  grossRevenueMicroRub: MicroRub;
  estimatedFeesMicroRub: MicroRub;
  actualFeesMicroRub: MicroRub;
  usedFeesMicroRub: MicroRub;
  feeQuality: FinanceQuality;
  effectiveFeeBps: number | null;
}

export interface ModelEconomicsRow {
  modelId: string;
  slug: string;
  requestCount: number;
  inputTokens: bigint;
  outputTokens: bigint;
  providerActualCostMicroRub: MicroRub;
  userSettledUsageMicroRub: MicroRub;
  differenceMicroRub: MicroRub;
  averageCostPerRequestMicroRub: MicroRub | null;
}

export interface FinanceTimeseriesPoint {
  date: string;
  grossRevenueMicroRub: MicroRub;
  realizedAiCogsMicroRub: MicroRub;
  realizedContributionMicroRub: MicroRub;
}
