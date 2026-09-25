export const DIRECT_CHAT_ERROR_CODES = [
  "NOT_FOUND",
  "DISABLED",
  "VALIDATION_ERROR",
  "FORBIDDEN",
  "CONFLICT",
  "DEVICE_REVOKED",
  "RECIPIENT_DEVICE_MISSING",
  "PREKEYS_DEPLETED",
  "TAMPERED",
] as const;

export type DirectChatErrorCode = (typeof DIRECT_CHAT_ERROR_CODES)[number];

const HTTP_STATUS_BY_CODE: Record<DirectChatErrorCode, number> = {
  NOT_FOUND: 404,
  DISABLED: 503,
  VALIDATION_ERROR: 400,
  FORBIDDEN: 403,
  CONFLICT: 409,
  DEVICE_REVOKED: 403,
  RECIPIENT_DEVICE_MISSING: 409,
  PREKEYS_DEPLETED: 409,
  TAMPERED: 400,
};

export class DirectChatError extends Error {
  readonly code: DirectChatErrorCode;
  readonly httpStatus: number;

  constructor(code: DirectChatErrorCode, message: string) {
    super(message);
    this.name = "DirectChatError";
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code];
  }
}

export function isDirectChatError(error: unknown): error is DirectChatError {
  return error instanceof DirectChatError;
}
