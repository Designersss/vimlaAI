import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { isAiError, type AiErrorCode } from "@vimla/ai";
import { isBillingError, type BillingErrorCode } from "@vimla/billing";
import {
  apiErrorResponseSchema,
  type ApiErrorCode,
} from "@vimla/contracts";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const requestId = String(request.id);

    if (isAiError(exception)) {
      void response.status(exception.httpStatus).send(
        apiErrorResponseSchema.parse({
          error: {
            code: aiCodeToApi(exception.code),
            message: exception.message,
            requestId,
          },
        }),
      );
      return;
    }

    if (isBillingError(exception)) {
      void response.status(exception.httpStatus).send(
        apiErrorResponseSchema.parse({
          error: {
            code: billingCodeToApi(exception.code),
            message: exception.message,
            requestId,
          },
        }),
      );
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      void response.status(status).send(
        apiErrorResponseSchema.parse({
          error: {
            code: statusToErrorCode(status),
            message: publicErrorMessage(exception),
            requestId,
          },
        }),
      );
      return;
    }

    void response.status(HttpStatus.INTERNAL_SERVER_ERROR).send(
      apiErrorResponseSchema.parse({
        error: {
          code: "internal_error",
          message: "Request failed",
          requestId,
        },
      }),
    );
  }
}

function aiCodeToApi(code: AiErrorCode): ApiErrorCode {
  switch (code) {
    case "UNKNOWN_MODEL":
      return "unknown_model";
    case "INACTIVE_MODEL":
      return "inactive_model";
    case "MODEL_UNAVAILABLE":
      return "model_unavailable";
    case "MESSAGE_TOO_LARGE":
      return "message_too_large";
    case "AI_DISABLED":
      return "ai_disabled";
    case "AI_REQUEST_IN_PROGRESS":
      return "ai_request_in_progress";
    case "AI_REQUEST_COST_LIMIT":
      return "ai_request_cost_limit";
    case "AI_PROVIDER_BALANCE_UNAVAILABLE":
      return "ai_provider_balance_unavailable";
    case "AI_RECONCILIATION_REQUIRED":
    case "PROVIDER_USAGE_INVALID":
    case "PROVIDER_AMBIGUOUS_FAILURE":
      return "ai_reconciliation_required";
    case "PROVIDER_REJECTED":
      return "internal_error";
    default:
      return "internal_error";
  }
}

function billingCodeToApi(code: BillingErrorCode): ApiErrorCode {
  switch (code) {
    case "INSUFFICIENT_USAGE":
      return "insufficient_usage";
    case "INVALID_TOPUP_AMOUNT":
      return "invalid_topup_amount";
    case "NO_ACTIVE_SUBSCRIPTION":
      return "no_active_subscription";
    case "SUBSCRIPTION_ALREADY_ACTIVE":
      return "conflict";
    case "RESERVATION_NOT_FOUND":
      return "reservation_not_found";
    case "RESERVATION_ALREADY_SETTLED":
      return "reservation_already_settled";
    case "RESERVATION_ALREADY_RELEASED":
      return "reservation_already_released";
    case "RESERVATION_CONFLICT":
      return "reservation_conflict";
    case "FINANCIAL_OPERATION_FAILED":
      return "financial_operation_failed";
    case "PAYMENT_NOT_FOUND":
    case "PLAN_NOT_FOUND":
    case "MOCK_PROVIDER_DISABLED":
      return "not_found";
    default:
      return "internal_error";
  }
}

function statusToErrorCode(status: number): ApiErrorCode {
  switch (status) {
    case 400:
      return "validation_error";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 429:
      return "rate_limited";
    default:
      return "internal_error";
  }
}

function publicErrorMessage(exception: HttpException): string {
  const payload = exception.getResponse();
  if (typeof payload === "string") {
    return payload;
  }

  if (payload !== null && typeof payload === "object" && "message" in payload) {
    const message = payload.message;
    if (typeof message === "string") {
      return message;
    }
  }

  return "Request failed";
}
