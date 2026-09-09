export const WORKSPACE_ERROR_CODES = [
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "INVALID_TIMEZONE",
  "TIMEZONE_REQUIRED",
  "PAYLOAD_TOO_LARGE",
  "REORDER_INVALID",
  "LIST_FULL",
  "STATUS_INVALID",
  "CONFLICT",
] as const;

export type WorkspaceErrorCode = (typeof WORKSPACE_ERROR_CODES)[number];

const HTTP_STATUS_BY_CODE: Record<WorkspaceErrorCode, number> = {
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  INVALID_TIMEZONE: 400,
  TIMEZONE_REQUIRED: 400,
  PAYLOAD_TOO_LARGE: 400,
  REORDER_INVALID: 400,
  LIST_FULL: 400,
  STATUS_INVALID: 400,
  CONFLICT: 409,
};

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;
  readonly httpStatus: number;

  constructor(code: WorkspaceErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code];
  }
}

export function isWorkspaceError(error: unknown): error is WorkspaceError {
  return error instanceof WorkspaceError;
}
