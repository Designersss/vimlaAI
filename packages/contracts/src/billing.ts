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
