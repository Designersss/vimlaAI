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
import { isWorkspaceError, type WorkspaceErrorCode } from "@vimla/workspace";
import { isOperatorError, type OperatorErrorCode } from "@vimla/operator";
import { isProjectError, type ProjectErrorCode } from "@vimla/projects";
import { isDirectChatError, type DirectChatErrorCode } from "@vimla/direct-chats";
import { isMemoryError, type MemoryErrorCode } from "@vimla/context";
import { isNotificationPlatformError, type NotificationPlatformError } from "@vimla/notifications";
import {
  apiErrorResponseSchema,
  type ApiErrorCode,
} from "@vimla/contracts";
import { ZodError } from "zod";

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

    if (isOperatorError(exception)) {
      void response.status(exception.httpStatus).send(
        apiErrorResponseSchema.parse({
          error: {
            code: operatorCodeToApi(exception.code),
            message: exception.message,
            requestId,
          },
        }),
      );
      return;
    }

    if (isProjectError(exception)) {
      void response.status(exception.httpStatus).send(
        apiErrorResponseSchema.parse({
          error: {
            code: projectCodeToApi(exception.code),
            message: exception.message,
            requestId,
          },
        }),
      );
      return;
    }

    if (isDirectChatError(exception)) {
      void response.status(exception.httpStatus).send(
        apiErrorResponseSchema.parse({
          error: {
            code: directChatCodeToApi(exception.code),
            message: exception.message,
            requestId,
          },
        }),
      );
      return;
    }

    if (isMemoryError(exception)) {
      void response.status(exception.httpStatus).send(
        apiErrorResponseSchema.parse({
          error: {
            code: memoryCodeToApi(exception.code),
            message: exception.message,
            requestId,
          },
        }),
      );
      return;
    }

    if (isWorkspaceError(exception)) {
      void response.status(exception.httpStatus).send(
        apiErrorResponseSchema.parse({
          error: {
            code: workspaceCodeToApi(exception.code),
            message: exception.message,
            requestId,
          },
        }),
      );
      return;
    }

    if (isNotificationPlatformError(exception)) {
      void response.status(exception.httpStatus).send(
        apiErrorResponseSchema.parse({
          error: {
            code: notificationCodeToApi(exception),
            message: exception.message,
            requestId,
          },
        }),
      );
      return;
    }

    if (exception instanceof ZodError) {
      void response.status(HttpStatus.BAD_REQUEST).send(
        apiErrorResponseSchema.parse({
          error: {
            code: "validation_error",
            message: "Invalid request",
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
            code: httpExceptionCode(exception, status),
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

function operatorCodeToApi(code: OperatorErrorCode): ApiErrorCode {
  switch (code) {
    case "NOT_FOUND":
      return "not_found";
    case "DISABLED":
      return "operator_disabled";
    case "VALIDATION_ERROR":
    case "PLAN_INVALID":
      return "operator_plan_invalid";
    case "IN_PROGRESS":
      return "operator_run_in_progress";
    case "CONFIRMATION_REQUIRED":
      return "operator_confirmation_required";
    case "CONFIRMATION_INVALID":
      return "operator_confirmation_invalid";
    case "CLARIFICATION_REQUIRED":
      return "operator_clarification_required";
    case "TOOL_DENIED":
      return "operator_tool_denied";
    case "CONFLICT":
      return "conflict";
    default:
      return "internal_error";
  }
}

function directChatCodeToApi(code: DirectChatErrorCode): ApiErrorCode {
  switch (code) {
    case "NOT_FOUND":
      return "not_found";
    case "DISABLED":
      return "direct_chats_disabled";
    case "VALIDATION_ERROR":
    case "TAMPERED":
      return "validation_error";
    case "FORBIDDEN":
      return "forbidden";
    case "CONFLICT":
      return "conflict";
    case "DEVICE_REVOKED":
      return "direct_chat_device_revoked";
    case "RECIPIENT_DEVICE_MISSING":
      return "direct_chat_recipient_device_missing";
    default:
      return "internal_error";
  }
}

function projectCodeToApi(code: ProjectErrorCode): ApiErrorCode {
  switch (code) {
    case "NOT_FOUND":
      return "not_found";
    case "DISABLED":
      return "projects_disabled";
    case "VALIDATION_ERROR":
      return "validation_error";
    case "FORBIDDEN":
      return "forbidden";
    case "CONFLICT":
      return "conflict";
    case "PLAN_LOCKED":
      return "project_plan_locked";
    case "ENTITLEMENT_DENIED":
      return "project_entitlement_denied";
    case "OWNED_LIMIT":
      return "project_owned_limit";
    case "MEMBER_LIMIT":
      return "project_member_limit";
    case "INVITE_INVALID":
      return "project_invite_invalid";
    case "INVITE_EMAIL_MISMATCH":
      return "project_invite_email_mismatch";
    case "ROLE_FORBIDDEN":
      return "project_role_forbidden";
    default:
      return "internal_error";
  }
}

function memoryCodeToApi(code: MemoryErrorCode): ApiErrorCode {
  switch (code) {
    case "NOT_FOUND":
      return "not_found";
    case "DISABLED":
      return "memory_disabled";
    case "FORBIDDEN":
      return "forbidden";
    case "CONFLICT":
    case "STORAGE_LIMIT":
      return "conflict";
    case "SENSITIVE_CONTENT":
      return "memory_sensitive_content";
    case "VALIDATION_ERROR":
      return "validation_error";
    default:
      return "internal_error";
  }
}

function workspaceCodeToApi(code: WorkspaceErrorCode): ApiErrorCode {
  switch (code) {
    case "NOT_FOUND":
      return "not_found";
    case "VALIDATION_ERROR":
      return "validation_error";
    case "INVALID_TIMEZONE":
      return "invalid_timezone";
    case "TIMEZONE_REQUIRED":
      return "timezone_required";
    case "PAYLOAD_TOO_LARGE":
      return "workspace_payload_too_large";
    case "REORDER_INVALID":
      return "workspace_reorder_invalid";
    case "LIST_FULL":
      return "workspace_list_full";
    case "STATUS_INVALID":
      return "workspace_status_invalid";
    case "CONFLICT":
      return "conflict";
    default:
      return "internal_error";
  }
}

function notificationCodeToApi(error: NotificationPlatformError): ApiErrorCode {
  switch (error.code) {
    case "NOT_FOUND":
      return "not_found";
    case "EMAIL_UNVERIFIED":
      return "email_not_verified";
    case "VALIDATION_ERROR":
      return "validation_error";
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
      return "subscription_already_active";
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
      return "payment_not_found";
    case "PLAN_NOT_FOUND":
    case "MOCK_PROVIDER_DISABLED":
      return "not_found";
    case "PAYMENT_TEMPORARILY_UNAVAILABLE":
      return "payment_temporarily_unavailable";
    case "PAYMENT_ALREADY_PROCESSED":
      return "payment_already_processed";
    case "PAYMENT_AMOUNT_INVALID":
      return "payment_amount_invalid";
    case "PAYMENT_RECONCILIATION_REQUIRED":
      return "payment_reconciliation_required";
    case "PAYMENT_PROVIDER_UNAVAILABLE":
      return "payment_provider_unavailable";
    case "PAYMENT_RATE_LIMITED":
      return "payment_rate_limited";
    case "PAYMENT_NOTIFICATION_INVALID":
      return "validation_error";
    case "POLICY_CONFIRMATION_REQUIRED":
      return "validation_error";
    case "ENTITLEMENT_INVALID":
      return "validation_error";
    default:
      return "internal_error";
  }
}

function httpExceptionCode(exception: HttpException, status: number): ApiErrorCode {
  const payload = exception.getResponse();
  if (payload !== null && typeof payload === "object" && "code" in payload) {
    const code = payload.code;
    if (typeof code === "string") {
      const parsed = apiErrorResponseSchema.shape.error.shape.code.safeParse(code);
      if (parsed.success) {
        return parsed.data;
      }
    }
  }

  return statusToErrorCode(status);
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
