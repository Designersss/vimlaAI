export class ContextError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ContextValidationError extends ContextError {
  constructor(message: string) {
    super("CONTEXT_VALIDATION", message);
  }
}

export class ContextConflictError extends ContextError {
  constructor(message: string) {
    super("CONTEXT_CONFLICT", message);
  }
}

export class ContextNotFoundError extends ContextError {
  constructor(message: string) {
    super("CONTEXT_NOT_FOUND", message);
  }
}

export class ContextAccessDeniedError extends ContextError {
  constructor(message: string) {
    super("CONTEXT_ACCESS_DENIED", message);
  }
}
