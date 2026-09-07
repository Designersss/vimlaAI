export const BILLING_ERROR_CODES = [
  "INSUFFICIENT_USAGE",
  "INVALID_TOPUP_AMOUNT",
  "NO_ACTIVE_SUBSCRIPTION",
  "SUBSCRIPTION_ALREADY_ACTIVE",
  "RESERVATION_NOT_FOUND",
  "RESERVATION_ALREADY_SETTLED",
  "RESERVATION_ALREADY_RELEASED",
  "RESERVATION_CONFLICT",
  "FINANCIAL_OPERATION_FAILED",
  "PAYMENT_NOT_FOUND",
  "PLAN_NOT_FOUND",
  "MOCK_PROVIDER_DISABLED",
] as const;

export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[number];

const HTTP_STATUS_BY_CODE: Record<BillingErrorCode, number> = {
  INSUFFICIENT_USAGE: 402,
  INVALID_TOPUP_AMOUNT: 400,
  NO_ACTIVE_SUBSCRIPTION: 404,
  SUBSCRIPTION_ALREADY_ACTIVE: 409,
  RESERVATION_NOT_FOUND: 404,
  RESERVATION_ALREADY_SETTLED: 409,
  RESERVATION_ALREADY_RELEASED: 409,
  RESERVATION_CONFLICT: 409,
  FINANCIAL_OPERATION_FAILED: 503,
  PAYMENT_NOT_FOUND: 404,
  PLAN_NOT_FOUND: 404,
  MOCK_PROVIDER_DISABLED: 404,
};

export class BillingError extends Error {
  readonly code: BillingErrorCode;
  readonly httpStatus: number;

  constructor(code: BillingErrorCode, message: string) {
    super(message);
    this.name = "BillingError";
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code];
  }
}

export function isBillingError(error: unknown): error is BillingError {
  return error instanceof BillingError;
}
