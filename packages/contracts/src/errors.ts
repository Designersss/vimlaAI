import { z } from "zod";

export const apiErrorCodeSchema = z.enum([
  "internal_error",
  "validation_error",
  "not_found",
  "unauthorized",
  "forbidden",
  "conflict",
  "rate_limited",
  "insufficient_allowance",
  "insufficient_usage",
  "invalid_topup_amount",
  "no_active_subscription",
  "reservation_not_found",
  "reservation_already_settled",
  "reservation_already_released",
  "reservation_conflict",
  "financial_operation_failed",
  "ai_disabled",
  "ai_request_in_progress",
  "ai_request_cost_limit",
  "ai_provider_balance_unavailable",
  "ai_reconciliation_required",
  "unknown_model",
  "inactive_model",
  "model_unavailable",
  "message_too_large",
  "origin_forbidden",
  "concurrency_limited",
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    requestId: z.string().optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
