export const AI_ERROR_CODES = [
  "UNKNOWN_MODEL",
  "INACTIVE_MODEL",
  "MODEL_UNAVAILABLE",
  "MESSAGE_TOO_LARGE",
  "AI_DISABLED",
  "AI_REQUEST_IN_PROGRESS",
  "AI_REQUEST_COST_LIMIT",
  "AI_PROVIDER_BALANCE_UNAVAILABLE",
  "AI_RECONCILIATION_REQUIRED",
  "PROVIDER_USAGE_INVALID",
  "PROVIDER_REJECTED",
  "PROVIDER_AMBIGUOUS_FAILURE",
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly httpStatus: number;

  constructor(code: AiErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function isAiError(error: unknown): error is AiError {
  return error instanceof AiError;
}
