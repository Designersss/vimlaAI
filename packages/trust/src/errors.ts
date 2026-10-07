export const TRUST_ERROR_CODES = [
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "FORBIDDEN",
  "CONFLICT",
  "EVIDENCE_INVALID",
] as const;

export type TrustErrorCode = (typeof TRUST_ERROR_CODES)[number];

export class TrustError extends Error {
  constructor(
    readonly code: TrustErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TrustError";
  }
}

export function isTrustError(error: unknown): error is TrustError {
  return error instanceof TrustError;
}
