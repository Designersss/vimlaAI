export const OPERATOR_ERROR_CODES = [
  "NOT_FOUND",
  "DISABLED",
  "VALIDATION_ERROR",
  "IN_PROGRESS",
  "CONFIRMATION_REQUIRED",
  "CONFIRMATION_INVALID",
  "CLARIFICATION_REQUIRED",
  "PLAN_INVALID",
  "TOOL_DENIED",
  "CONTEXT_REVOKED",
  "CONFLICT",
] as const;

export type OperatorErrorCode = (typeof OPERATOR_ERROR_CODES)[number];

const HTTP_STATUS_BY_CODE: Record<OperatorErrorCode, number> = {
  NOT_FOUND: 404,
  DISABLED: 503,
  VALIDATION_ERROR: 400,
  IN_PROGRESS: 409,
  CONFIRMATION_REQUIRED: 409,
  CONFIRMATION_INVALID: 400,
  CLARIFICATION_REQUIRED: 409,
  PLAN_INVALID: 400,
  TOOL_DENIED: 400,
  CONTEXT_REVOKED: 409,
  CONFLICT: 409,
};

export class OperatorError extends Error {
  readonly code: OperatorErrorCode;
  readonly httpStatus: number;

  constructor(code: OperatorErrorCode, message: string) {
    super(message);
    this.name = "OperatorError";
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code];
  }
}

export function isOperatorError(error: unknown): error is OperatorError {
  return error instanceof OperatorError;
}
