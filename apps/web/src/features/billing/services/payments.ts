import {
  checkoutResponseSchema,
  paymentsResponseSchema,
  paymentViewSchema,
  plansResponseSchema,
  subscriptionResponseSchema,
  type CheckoutResponse,
  type PaymentView,
  type PaymentsResponse,
  type PlansResponse,
  type SubscriptionResponse,
} from "@vimla/contracts";
import { publicWebConfig } from "../../../shared/config/public-env";
import { AuthRequiredError } from "../../auth/services/current-user";

async function api<T>(
  path: string,
  parse: (payload: unknown) => T,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${publicWebConfig.apiBaseUrl}${path}`, {
    credentials: "include",
    cache: "no-store",
    ...init,
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      payload !== null &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error !== null &&
      typeof payload.error === "object" &&
      "code" in payload.error
        ? String((payload.error as { code: unknown }).code)
        : "internal_error";
    const error = new Error(code);
    error.name = "ApiError";
    (error as Error & { code: string }).code = code;
    throw error;
  }
  return parse(payload);
}

export async function fetchPlans(): Promise<PlansResponse> {
  return api("/v1/plans", (payload) => plansResponseSchema.parse(payload));
}

export async function fetchSubscription(): Promise<SubscriptionResponse> {
  return api("/v1/subscription", (payload) => subscriptionResponseSchema.parse(payload));
}

export async function fetchPayments(): Promise<PaymentsResponse> {
  return api("/v1/payments", (payload) => paymentsResponseSchema.parse(payload));
}

export async function fetchPayment(paymentId: string): Promise<PaymentView> {
  return api(`/v1/payments/${encodeURIComponent(paymentId)}`, (payload) =>
    paymentViewSchema.parse(payload),
  );
}

export async function checkoutSubscription(
  planCode: "LITE" | "START" | "PRO",
  idempotencyKey: string,
): Promise<CheckoutResponse> {
  return api(
    "/v1/payments/subscriptions",
    (payload) => checkoutResponseSchema.parse(payload),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planCode, idempotencyKey }),
    },
  );
}

export async function checkoutTopup(
  amountMicroRub: string,
  idempotencyKey: string,
): Promise<CheckoutResponse> {
  return api(
    "/v1/payments/topups",
    (payload) => checkoutResponseSchema.parse(payload),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amountMicroRub, idempotencyKey }),
    },
  );
}
