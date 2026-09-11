export const PROJECT_ERROR_CODES = [
  "NOT_FOUND",
  "DISABLED",
  "VALIDATION_ERROR",
  "FORBIDDEN",
  "CONFLICT",
  "PLAN_LOCKED",
  "ENTITLEMENT_DENIED",
  "OWNED_LIMIT",
  "MEMBER_LIMIT",
  "INVITE_INVALID",
  "INVITE_EMAIL_MISMATCH",
  "ROLE_FORBIDDEN",
] as const;

export type ProjectErrorCode = (typeof PROJECT_ERROR_CODES)[number];

const HTTP_STATUS_BY_CODE: Record<ProjectErrorCode, number> = {
  NOT_FOUND: 404,
  DISABLED: 503,
  VALIDATION_ERROR: 400,
  FORBIDDEN: 403,
  CONFLICT: 409,
  PLAN_LOCKED: 403,
  ENTITLEMENT_DENIED: 403,
  OWNED_LIMIT: 403,
  MEMBER_LIMIT: 403,
  INVITE_INVALID: 404,
  INVITE_EMAIL_MISMATCH: 403,
  ROLE_FORBIDDEN: 403,
};

export class ProjectError extends Error {
  readonly code: ProjectErrorCode;
  readonly httpStatus: number;

  constructor(code: ProjectErrorCode, message: string) {
    super(message);
    this.name = "ProjectError";
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code];
  }
}

export function isProjectError(error: unknown): error is ProjectError {
  return error instanceof ProjectError;
}
