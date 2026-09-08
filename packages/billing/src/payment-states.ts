import type { PaymentStatus } from "./types.js";

export const TBANK_PAYMENT_STATUSES = [
  "NEW",
  "FORM_SHOWED",
  "AUTHORIZING",
  "3DS_CHECKING",
  "3DS_CHECKED",
  "AUTHORIZED",
  "CONFIRMING",
  "CONFIRMED",
  "REVERSING",
  "PARTIAL_REVERSED",
  "REVERSED",
  "REFUNDING",
  "PARTIAL_REFUNDED",
  "REFUNDED",
  "CANCELED",
  "REJECTED",
  "DEADLINE_EXPIRED",
  "AUTH_FAIL",
] as const;

export type TBankPaymentStatus = (typeof TBANK_PAYMENT_STATUSES)[number];

const IN_FLIGHT = new Set<string>([
  "NEW",
  "FORM_SHOWED",
  "AUTHORIZING",
  "3DS_CHECKING",
  "3DS_CHECKED",
  "AUTHORIZED",
  "CONFIRMING",
]);

const FAILURE = new Set<string>(["REJECTED", "DEADLINE_EXPIRED", "AUTH_FAIL"]);

export type ProviderMoneyEvent =
  | "ignore"
  | "pending"
  | "confirmed"
  | "failed"
  | "canceled"
  | "refunded"
  | "partially_refunded";

export function classifyTBankStatus(status: string): ProviderMoneyEvent {
  const normalized = status.toUpperCase();
  if (normalized === "CONFIRMED") {
    return "confirmed";
  }
  if (IN_FLIGHT.has(normalized)) {
    return "pending";
  }
  if (FAILURE.has(normalized)) {
    return "failed";
  }
  if (normalized === "CANCELED" || normalized === "REVERSED" || normalized === "PARTIAL_REVERSED") {
    return "canceled";
  }
  if (normalized === "REFUNDED") {
    return "refunded";
  }
  if (normalized === "PARTIAL_REFUNDED") {
    return "partially_refunded";
  }
  return "ignore";
}

const TERMINAL_PAID = new Set<PaymentStatus>([
  "SUCCEEDED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "RECONCILIATION_REQUIRED",
]);

export function nextDomainStatus(
  current: PaymentStatus,
  event: ProviderMoneyEvent,
): PaymentStatus | null {
  if (event === "ignore" || event === "pending") {
    if (current === "CREATED") {
      return "PENDING";
    }
    return null;
  }

  if (event === "confirmed") {
    if (current === "SUCCEEDED" || current === "REFUNDED" || current === "PARTIALLY_REFUNDED") {
      return null;
    }
    if (current === "RECONCILIATION_REQUIRED") {
      return null;
    }
    if (current === "CREATED" || current === "PENDING") {
      return "SUCCEEDED";
    }
    return null;
  }

  if (event === "failed") {
    if (TERMINAL_PAID.has(current) || current === "CANCELED") {
      return null;
    }
    return "FAILED";
  }

  if (event === "canceled") {
    if (current === "SUCCEEDED" || current === "REFUNDED" || current === "PARTIALLY_REFUNDED") {
      return null;
    }
    if (current === "FAILED") {
      return null;
    }
    return "CANCELED";
  }

  if (event === "refunded") {
    if (current === "CREATED" || current === "PENDING" || current === "FAILED" || current === "CANCELED") {
      return current === "PENDING" || current === "CREATED" ? "CANCELED" : null;
    }
    return "REFUNDED";
  }

  if (event === "partially_refunded") {
    if (current === "SUCCEEDED" || current === "PARTIALLY_REFUNDED") {
      return "PARTIALLY_REFUNDED";
    }
    return null;
  }

  return null;
}

export function isPaidDomainStatus(status: PaymentStatus): boolean {
  return status === "SUCCEEDED";
}
