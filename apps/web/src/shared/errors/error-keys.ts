const AUTH_ERROR_MAP: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "auth.errors.invalidCredentials",
  INVALID_PASSWORD: "auth.errors.invalidCredentials",
  USER_ALREADY_EXISTS: "auth.errors.registrationFailed",
  REGISTRATION_FAILED: "auth.errors.registrationFailed",
  INVALID_OTP: "auth.errors.invalidOtp",
  OTP_EXPIRED: "auth.errors.otpExpired",
  TOO_MANY_ATTEMPTS: "auth.errors.otpTooManyAttempts",
  OTP_RESEND_TOO_SOON: "auth.errors.otpResendTooSoon",
  TOO_MANY_REQUESTS: "auth.errors.rateLimited",
  RATE_LIMITED: "auth.errors.rateLimited",
  INVALID_TOKEN: "auth.errors.invalidResetToken",
  TOKEN_EXPIRED: "auth.errors.resetTokenExpired",
  EMAIL_NOT_VERIFIED: "auth.errors.emailNotVerified",
  SESSION_NOT_FOUND: "auth.errors.sessionNotFound",
  PASSWORD_TOO_SHORT: "validation.passwordMin",
  NOTIFICATION_TEMPORARILY_UNAVAILABLE: "errors.notification_temporarily_unavailable",
};

export interface AuthClientErrorLike {
  code?: string | undefined;
  status?: number | undefined;
  statusCode?: number | undefined;
  retryAfter?: number | string | undefined;
}

export function authErrorMessageKey(code: string | undefined): string {
  if (!code) {
    return "errors.generic";
  }

  return AUTH_ERROR_MAP[code] ?? AUTH_ERROR_MAP[code.toUpperCase()] ?? "errors.generic";
}

export function isAuthRateLimitError(error: AuthClientErrorLike | null | undefined): boolean {
  if (!error) {
    return false;
  }

  const code = error.code?.toUpperCase();
  if (code === "OTP_RESEND_TOO_SOON" || code === "TOO_MANY_ATTEMPTS") {
    return false;
  }

  if (code === "TOO_MANY_REQUESTS" || code === "RATE_LIMITED") {
    return true;
  }

  return error.status === 429 || error.statusCode === 429;
}

export function authRetryAfterSeconds(
  error: AuthClientErrorLike | null | undefined,
  headerSeconds?: number | null,
): number | null {
  if (!isAuthRateLimitError(error)) {
    return null;
  }

  const fromError = parsePositiveInt(error?.retryAfter);
  if (fromError !== null) {
    return fromError;
  }

  const fromHeader = parsePositiveInt(headerSeconds);
  if (fromHeader !== null) {
    return fromHeader;
  }

  return 60;
}

function parsePositiveInt(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.ceil(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

export function apiErrorMessageKey(code: string | undefined): string {
  if (!code) {
    return "errors.generic";
  }

  return `errors.${code}`;
}
