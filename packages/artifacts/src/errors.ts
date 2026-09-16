export class ArtifactError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ArtifactError";
  }
}

export class ArtifactNotFoundError extends ArtifactError {
  constructor() {
    super("Artifact was not found", "ARTIFACT_NOT_FOUND");
    this.name = "ArtifactNotFoundError";
  }
}

export class ArtifactValidationError extends ArtifactError {
  constructor(message: string) {
    super(message, "ARTIFACT_VALIDATION_ERROR");
    this.name = "ArtifactValidationError";
  }
}

export class ArtifactConflictError extends ArtifactError {
  constructor(message: string) {
    super(message, "ARTIFACT_CONFLICT");
    this.name = "ArtifactConflictError";
  }
}

export class ArtifactBindingError extends ArtifactError {
  constructor(message: string) {
    super(message, "ARTIFACT_BINDING_ERROR");
    this.name = "ArtifactBindingError";
  }
}
