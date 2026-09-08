import { z } from "zod";

export const microRubStringSchema = z.string().regex(/^-?\d+$/);

export const usageGroupSchema = z.object({
  totalMicroRub: microRubStringSchema,
  spentMicroRub: microRubStringSchema,
  reservedMicroRub: microRubStringSchema,
  remainingMicroRub: microRubStringSchema,
  usedPercent: z.number().int().min(0).max(100),
});
export type UsageGroup = z.infer<typeof usageGroupSchema>;

export const usageResponseSchema = z.object({
  monthly: usageGroupSchema,
  topup: usageGroupSchema,
});
export type UsageResponse = z.infer<typeof usageResponseSchema>;

export const retailPlanSchema = z.object({
  code: z.enum(["LITE", "START", "PRO"]),
  name: z.string(),
  priceMicroRub: microRubStringSchema,
});
export type RetailPlan = z.infer<typeof retailPlanSchema>;

export const plansResponseSchema = z.object({
  plans: z.array(retailPlanSchema),
});
export type PlansResponse = z.infer<typeof plansResponseSchema>;

export const subscriptionResponseSchema = z.object({
  subscription: z
    .object({
      id: z.string().min(1),
      status: z.literal("ACTIVE"),
      planCode: z.enum(["LITE", "START", "PRO"]),
      planName: z.string(),
      periodStart: z.string(),
      periodEnd: z.string(),
    })
    .nullable(),
});
export type SubscriptionResponse = z.infer<typeof subscriptionResponseSchema>;

export const mockSubscriptionPurchaseSchema = z
  .object({
    planCode: z.enum(["LITE", "START", "PRO"]),
  })
  .strict();
export type MockSubscriptionPurchase = z.infer<typeof mockSubscriptionPurchaseSchema>;

export const mockTopupPurchaseSchema = z
  .object({
    amountMicroRub: microRubStringSchema,
  })
  .strict();
export type MockTopupPurchase = z.infer<typeof mockTopupPurchaseSchema>;

export const subscriptionCheckoutSchema = z
  .object({
    planCode: z.enum(["LITE", "START", "PRO"]),
    idempotencyKey: z.string().uuid(),
  })
  .strict();
export type SubscriptionCheckout = z.infer<typeof subscriptionCheckoutSchema>;

export const topupCheckoutSchema = z
  .object({
    amountMicroRub: microRubStringSchema,
    idempotencyKey: z.string().uuid(),
  })
  .strict();
export type TopupCheckout = z.infer<typeof topupCheckoutSchema>;

export const checkoutResponseSchema = z.object({
  paymentId: z.string().min(1),
  paymentUrl: z.url(),
});
export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;

export const paymentViewSchema = z.object({
  paymentId: z.string().min(1),
  kind: z.enum(["SUBSCRIPTION", "TOPUP"]),
  status: z.enum([
    "CREATED",
    "PENDING",
    "SUCCEEDED",
    "FAILED",
    "CANCELED",
    "REFUNDED",
    "PARTIALLY_REFUNDED",
    "RECONCILIATION_REQUIRED",
  ]),
  amountMicroRub: microRubStringSchema,
  currency: z.string(),
  createdAt: z.string(),
  paymentUrl: z.url().nullable(),
  providerStatus: z.string().nullable(),
  orderId: z.string().min(1),
  providerPaymentId: z.string().nullable(),
});
export type PaymentView = z.infer<typeof paymentViewSchema>;

export const paymentsResponseSchema = z.object({
  payments: z.array(paymentViewSchema),
});
export type PaymentsResponse = z.infer<typeof paymentsResponseSchema>;
