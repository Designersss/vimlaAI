import { microRubFromJson, type MicroRub } from "./money.js";
import { BillingError } from "./errors.js";
import { PLAN_IDENTITY_CODES, type PaymentKind, type PlanIdentityCode } from "./types.js";

export const BILLING_SUBJECT_TYPES = ["USER"] as const;
export type BillingSubjectType = (typeof BILLING_SUBJECT_TYPES)[number];

export interface UserBillingSubject {
  type: "USER";
  userId: string;
}

export type BillingSubject = UserBillingSubject;

export function billingSubjectForActor(userId: string): BillingSubject {
  return { type: "USER", userId };
}

export interface CheckoutSnapshot {
  billingSubjectType: "USER";
  kind: PaymentKind;
  customerPaymentAmountMicroRub: MicroRub;
  providerBudgetGrantMicroRub: MicroRub;
  planVersionId?: string;
  planCode?: PlanIdentityCode;
  subscriptionPeriodDays?: number;
  topupRatioBps?: bigint;
  topupPolicyVersionId?: string;
}

export function toCheckoutSnapshotJson(snapshot: CheckoutSnapshot): Record<string, string | number> {
  const json: Record<string, string | number> = {
    billingSubjectType: snapshot.billingSubjectType,
    kind: snapshot.kind,
    customerPaymentAmountMicroRub: snapshot.customerPaymentAmountMicroRub.toString(10),
    providerBudgetGrantMicroRub: snapshot.providerBudgetGrantMicroRub.toString(10),
  };
  if (snapshot.planVersionId) {
    json.planVersionId = snapshot.planVersionId;
  }
  if (snapshot.planCode) {
    json.planCode = snapshot.planCode;
  }
  if (snapshot.subscriptionPeriodDays !== undefined) {
    json.subscriptionPeriodDays = snapshot.subscriptionPeriodDays;
  }
  if (snapshot.topupRatioBps !== undefined) {
    json.topupRatioBps = snapshot.topupRatioBps.toString(10);
  }
  if (snapshot.topupPolicyVersionId) {
    json.topupPolicyVersionId = snapshot.topupPolicyVersionId;
  }
  return json;
}

export function parseCheckoutSnapshot(value: unknown): CheckoutSnapshot {
  if (value === null || typeof value !== "object") {
    throw new BillingError("FINANCIAL_OPERATION_FAILED", "Checkout snapshot is missing");
  }
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if (kind !== "SUBSCRIPTION" && kind !== "TOPUP") {
    throw new BillingError("FINANCIAL_OPERATION_FAILED", "Checkout snapshot kind is invalid");
  }
  if (typeof record.customerPaymentAmountMicroRub !== "string") {
    throw new BillingError("FINANCIAL_OPERATION_FAILED", "Checkout snapshot amount is invalid");
  }
  if (typeof record.providerBudgetGrantMicroRub !== "string") {
    throw new BillingError("FINANCIAL_OPERATION_FAILED", "Checkout snapshot grant is invalid");
  }

  const planCode = record.planCode;
  if (planCode !== undefined) {
    if (typeof planCode !== "string" || !(PLAN_IDENTITY_CODES as readonly string[]).includes(planCode)) {
      throw new BillingError("FINANCIAL_OPERATION_FAILED", "Checkout snapshot plan is invalid");
    }
  }

  return {
    billingSubjectType: "USER",
    kind,
    customerPaymentAmountMicroRub: microRubFromJson(record.customerPaymentAmountMicroRub),
    providerBudgetGrantMicroRub: microRubFromJson(record.providerBudgetGrantMicroRub),
    planVersionId: typeof record.planVersionId === "string" ? record.planVersionId : undefined,
    planCode: typeof planCode === "string" ? (planCode as PlanIdentityCode) : undefined,
    subscriptionPeriodDays:
      typeof record.subscriptionPeriodDays === "number" ? record.subscriptionPeriodDays : undefined,
    topupRatioBps:
      typeof record.topupRatioBps === "string" ? BigInt(record.topupRatioBps) : undefined,
    topupPolicyVersionId:
      typeof record.topupPolicyVersionId === "string" ? record.topupPolicyVersionId : undefined,
  };
}
