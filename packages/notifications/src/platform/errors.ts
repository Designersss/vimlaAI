export const NOTIFICATION_ERROR_CODES = [
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "EMAIL_UNVERIFIED",
] as const;

export type NotificationPlatformErrorCode = (typeof NOTIFICATION_ERROR_CODES)[number];

const HTTP_STATUS_BY_CODE: Record<NotificationPlatformErrorCode, number> = {
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  EMAIL_UNVERIFIED: 400,
};

export class NotificationPlatformError extends Error {
  readonly code: NotificationPlatformErrorCode;
  readonly httpStatus: number;

  constructor(code: NotificationPlatformErrorCode, message: string) {
    super(message);
    this.name = "NotificationPlatformError";
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code];
  }
}

export function isNotificationPlatformError(error: unknown): error is NotificationPlatformError {
  return error instanceof NotificationPlatformError;
}
