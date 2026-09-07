import type { MicroRub } from "./money.js";

export const PLAN_CODES = ["LITE", "START", "PRO"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const SUBSCRIPTION_STATUSES = ["ACTIVE", "CANCELED", "EXPIRED"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const PAYMENT_KINDS = ["SUBSCRIPTION", "TOPUP"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const PAYMENT_STATUSES = ["PENDING", "SUCCEEDED", "FAILED", "REFUNDED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const USAGE_BUCKET_TYPES = ["MONTHLY", "TOPUP"] as const;
export type UsageBucketType = (typeof USAGE_BUCKET_TYPES)[number];

export const RESERVATION_STATUSES = [
  "ACTIVE",
  "SETTLED",
  "RELEASED",
  "ANOMALY",
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const LEDGER_TYPES = [
  "BUCKET_GRANTED",
  "TOPUP_GRANTED",
  "RESERVATION_CREATED",
  "USAGE_SETTLED",
  "RESERVATION_RELEASED",
  "ADJUSTMENT",
] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

export interface BillingPolicy {
  minTopupMicroRub: MicroRub;
  maxTopupMicroRub: MicroRub;
  topupProviderCostRatioBps: bigint;
  subscriptionPeriodDays: number;
}

export interface BillingLogger {
  info(fields: Record<string, string | number | boolean | null>, message: string): void;
  warn(fields: Record<string, string | number | boolean | null>, message: string): void;
  error(fields: Record<string, string | number | boolean | null>, message: string): void;
}

export interface LockedBucket {
  id: string;
  type: UsageBucketType;
  totalMicroRub: MicroRub;
  spentMicroRub: MicroRub;
  reservedMicroRub: MicroRub;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface ReservationAllocationPlan {
  bucketId: string;
  reservedMicroRub: MicroRub;
}

export interface ReservationView {
  id: string;
  userId: string;
  requestId: string;
  estimatedMicroRub: MicroRub;
  settledMicroRub: MicroRub;
  status: ReservationStatus;
  allocations: Array<{
    bucketId: string;
    reservedMicroRub: MicroRub;
    settledMicroRub: MicroRub;
  }>;
}

export interface PaymentEventInput {
  provider: string;
  providerEventId: string;
  providerPaymentId: string;
  eventType: "payment.succeeded" | "payment.failed" | "payment.refunded";
}

export interface ProcessPaymentResult {
  duplicate: boolean;
  paymentId: string;
  status: PaymentStatus;
  bucketId: string | null;
  subscriptionId: string | null;
}

export interface UsageGroupSnapshot {
  totalMicroRub: MicroRub;
  spentMicroRub: MicroRub;
  reservedMicroRub: MicroRub;
  remainingMicroRub: MicroRub;
  usedPercent: number;
}

export interface UsageSnapshot {
  monthly: UsageGroupSnapshot;
  topup: UsageGroupSnapshot;
}

export interface RetailPlan {
  code: PlanCode;
  name: string;
  priceMicroRub: MicroRub;
}

export interface ActiveSubscriptionView {
  id: string;
  status: SubscriptionStatus;
  planCode: PlanCode;
  planName: string;
  periodStart: Date;
  periodEnd: Date;
}
