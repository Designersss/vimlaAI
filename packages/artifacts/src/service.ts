import { Buffer } from "node:buffer";
import { Prisma, type PrismaClient } from "@vimla/database";
import {
  ArtifactBindingError,
  ArtifactConflictError,
  ArtifactNotFoundError,
  ArtifactValidationError,
} from "./errors.js";
import { canonicalJson, fingerprintArtifactContent } from "./fingerprint.js";
import {
  ARTIFACT_READ_PERMISSION,
  ARTIFACT_TYPES,
  type ArtifactContent,
  type ArtifactProvenance,
  type ArtifactReference,
  type ArtifactType,
  type CreateArtifactInput,
  type CreateArtifactVersionInput,
  type ReadArtifactVersionResult,
  type ResolvedArtifactInput,
} from "./types.js";

const MAX_NAME_LENGTH = 128;
const MAX_CLASSIFICATION_LENGTH = 128;
const MAX_CONTENT_REF_LENGTH = 4_096;
const MAX_INLINE_JSON_BYTES = 1_000_000;
const MAX_METADATA_JSON_BYTES = 65_536;

type UnknownRecord = Record<string, unknown>;

type StoredVersionShape = {
  id: string;
  artifactId: string;
  version: number;
  contentRef: string | null;
  contentJson: Prisma.JsonValue | null;
  fingerprint: string;
  metadata: Prisma.JsonValue | null;
};

type StoredArtifactShape = {
  id: string;
  outputName: string;
  type: string;
  classification: string;
};

export class ArtifactService {
  constructor(private readonly prisma: PrismaClient) {}

  async createArtifact(input: CreateArtifactInput): Promise<ArtifactReference> {
    validateIdentifier(input.actorUserId, "actorUserId");
    validateIdentifier(input.creatorInvocationId, "creatorInvocationId");
    const outputName = validateName(input.outputName, "outputName");
    const classification = validateClassification(input.classification);
    validateArtifactType(input.type);
    validateContent(input.content);
    validateMetadata(input.metadata, "metadata");
    validateMetadata(input.versionMetadata, "versionMetadata");
    const fingerprint = fingerprintArtifactContent(input.content);

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "invocation" WHERE "id" = ${input.creatorInvocationId} FOR UPDATE
      `;
      if (locked.length === 0) throw new ArtifactNotFoundError();

      const invocation = await tx.invocation.findUnique({
        where: { id: input.creatorInvocationId },
        select: {
          outputDeclarations: true,
          plan: { select: { userId: true } },
        },
      });
      if (!invocation || invocation.plan.userId !== input.actorUserId) {
        throw new ArtifactNotFoundError();
      }

      const declaredType = findDeclaredOutputType(invocation.outputDeclarations, outputName);
      if (!declaredType) {
        throw new ArtifactValidationError(`Output ${JSON.stringify(outputName)} is not declared by the invocation`);
      }
      if (declaredType !== input.type) {
        throw new ArtifactValidationError(
          `Output ${JSON.stringify(outputName)} requires ${declaredType}, received ${input.type}`,
        );
      }

      const existing = await tx.artifact.findUnique({
        where: {
          creatorInvocationId_outputName: {
            creatorInvocationId: input.creatorInvocationId,
            outputName,
          },
        },
        include: { versions: { orderBy: { version: "desc" } } },
      });
      if (existing) {
        if (existing.type !== input.type || existing.classification !== classification) {
          throw new ArtifactConflictError("Artifact identity already exists with different immutable attributes");
        }
        const matchingVersion = existing.versions.find((version) => version.fingerprint === fingerprint);
        if (matchingVersion) return toReference(existing, matchingVersion);
        throw new ArtifactConflictError("Artifact already exists with different content; create an explicit version");
      }

      const artifact = await tx.artifact.create({
        data: {
          creatorInvocationId: input.creatorInvocationId,
          outputName,
          type: input.type,
          classification,
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
          versions: {
            create: {
              version: 1,
              fingerprint,
              ...contentWriteData(input.content),
              ...(input.versionMetadata === undefined ? {} : { metadata: input.versionMetadata }),
            },
          },
        },
        include: { versions: true },
      });
      const version = artifact.versions[0];
      if (!version) throw new ArtifactConflictError("Artifact version was not created");
      return toReference(artifact, version);
    });
  }

  async createVersion(input: CreateArtifactVersionInput): Promise<ArtifactReference> {
    validateIdentifier(input.actorUserId, "actorUserId");
    validateIdentifier(input.artifactId, "artifactId");
    if (!Number.isInteger(input.expectedCurrentVersion) || input.expectedCurrentVersion < 1) {
      throw new ArtifactValidationError("expectedCurrentVersion must be a positive integer");
    }
    validateContent(input.content);
    validateMetadata(input.metadata, "metadata");
    const fingerprint = fingerprintArtifactContent(input.content);

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "artifact" WHERE "id" = ${input.artifactId} FOR UPDATE
      `;
      if (locked.length === 0) throw new ArtifactNotFoundError();

      const artifact = await tx.artifact.findUnique({
        where: { id: input.artifactId },
        include: {
          creatorInvocation: { select: { plan: { select: { userId: true } } } },
          versions: { orderBy: { version: "desc" }, take: 1 },
        },
      });
      if (!artifact || artifact.creatorInvocation.plan.userId !== input.actorUserId) {
        throw new ArtifactNotFoundError();
      }
      const current = artifact.versions[0];
      if (!current) throw new ArtifactConflictError("Artifact has no version history");

      if (current.version !== input.expectedCurrentVersion) {
        if (current.fingerprint === fingerprint) return toReference(artifact, current);
        throw new ArtifactConflictError(
          `Artifact version changed from expected ${input.expectedCurrentVersion} to ${current.version}`,
        );
      }
      if (current.fingerprint === fingerprint) return toReference(artifact, current);

      const version = await tx.artifactVersion.create({
        data: {
          artifactId: artifact.id,
          version: current.version + 1,
          fingerprint,
          ...contentWriteData(input.content),
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        },
      });
      return toReference(artifact, version);
    });
  }

  async grantReadAccess(input: {
    actorUserId: string;
    artifactId: string;
    granteeUserId: string;
  }): Promise<void> {
    validateIdentifier(input.actorUserId, "actorUserId");
    validateIdentifier(input.artifactId, "artifactId");
    validateIdentifier(input.granteeUserId, "granteeUserId");

    await this.prisma.$transaction(async (tx) => {
      const artifact = await tx.artifact.findUnique({
        where: { id: input.artifactId },
        select: { creatorInvocation: { select: { plan: { select: { userId: true } } } } },
      });
      if (!artifact || artifact.creatorInvocation.plan.userId !== input.actorUserId) {
        throw new ArtifactNotFoundError();
      }
      if (input.granteeUserId === input.actorUserId) return;

      const grantee = await tx.user.findUnique({ where: { id: input.granteeUserId }, select: { id: true } });
      if (!grantee) throw new ArtifactValidationError("granteeUserId does not identify an existing user");

      await tx.artifactAccessGrant.upsert({
        where: {
          artifactId_granteeUserId_permission: {
            artifactId: input.artifactId,
            granteeUserId: input.granteeUserId,
            permission: ARTIFACT_READ_PERMISSION,
          },
        },
        create: {
          artifactId: input.artifactId,
          granteeUserId: input.granteeUserId,
          permission: ARTIFACT_READ_PERMISSION,
        },
        update: { revokedAt: null },
      });
    });
  }

  async revokeReadAccess(input: {
    actorUserId: string;
    artifactId: string;
    granteeUserId: string;
  }): Promise<void> {
    validateIdentifier(input.actorUserId, "actorUserId");
    validateIdentifier(input.artifactId, "artifactId");
    validateIdentifier(input.granteeUserId, "granteeUserId");

    await this.prisma.$transaction(async (tx) => {
      const artifact = await tx.artifact.findUnique({
        where: { id: input.artifactId },
        select: { creatorInvocation: { select: { plan: { select: { userId: true } } } } },
      });
      if (!artifact || artifact.creatorInvocation.plan.userId !== input.actorUserId) {
        throw new ArtifactNotFoundError();
      }
      await tx.artifactAccessGrant.updateMany({
        where: {
          artifactId: input.artifactId,
          granteeUserId: input.granteeUserId,
          permission: ARTIFACT_READ_PERMISSION,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    });
  }

  async readVersion(input: {
    actorUserId: string;
    artifactVersionId: string;
  }): Promise<ReadArtifactVersionResult> {
    validateIdentifier(input.actorUserId, "actorUserId");
    validateIdentifier(input.artifactVersionId, "artifactVersionId");

    const version = await this.prisma.artifactVersion.findUnique({
      where: { id: input.artifactVersionId },
      include: {
        artifact: {
          include: {
            creatorInvocation: { select: { id: true, planId: true, plan: { select: { userId: true } } } },
            accessGrants: {
              where: {
                granteeUserId: input.actorUserId,
                permission: ARTIFACT_READ_PERMISSION,
                revokedAt: null,
              },
              select: { id: true },
            },
          },
        },
      },
    });
    if (!version || !isReadableBy(version.artifact, input.actorUserId)) {
      throw new ArtifactNotFoundError();
    }

    return {
      ...toReference(version.artifact, version),
      creatorInvocationId: version.artifact.creatorInvocation.id,
      planId: version.artifact.creatorInvocation.planId,
      content: storedContent(version),
      artifactMetadata: version.artifact.metadata,
      versionMetadata: version.metadata,
    };
  }

  async getProvenance(input: {
    actorUserId: string;
    artifactVersionId: string;
  }): Promise<ArtifactProvenance> {
    validateIdentifier(input.actorUserId, "actorUserId");
    validateIdentifier(input.artifactVersionId, "artifactVersionId");

    const version = await this.prisma.artifactVersion.findUnique({
      where: { id: input.artifactVersionId },
      include: {
        artifact: {
          include: {
            creatorInvocation: {
              select: {
                id: true,
                planId: true,
                plan: {
                  select: {
                    userId: true,
                    version: true,
                    planHash: true,
                    messageId: true,
                    conversationId: true,
                  },
                },
              },
            },
            accessGrants: {
              where: {
                granteeUserId: input.actorUserId,
                permission: ARTIFACT_READ_PERMISSION,
                revokedAt: null,
              },
              select: { id: true },
            },
          },
        },
      },
    });
    if (!version || !isReadableBy(version.artifact, input.actorUserId)) {
      throw new ArtifactNotFoundError();
    }

    const plan = version.artifact.creatorInvocation.plan;
    return {
      reference: toReference(version.artifact, version),
      creatorInvocationId: version.artifact.creatorInvocation.id,
      planId: version.artifact.creatorInvocation.planId,
      planVersion: plan.version,
      planHash: plan.planHash,
      messageId: plan.messageId,
      conversationId: plan.conversationId,
    };
  }

  async resolveInputBindings(input: {
    actorUserId: string;
    targetInvocationId: string;
  }): Promise<readonly ResolvedArtifactInput[]> {
    validateIdentifier(input.actorUserId, "actorUserId");
    validateIdentifier(input.targetInvocationId, "targetInvocationId");

    const target = await this.prisma.invocation.findUnique({
      where: { id: input.targetInvocationId },
      include: {
        plan: { select: { id: true, userId: true } },
        incomingDependencies: {
          select: {
            id: true,
            planId: true,
            fromInvocationId: true,
            toInvocationId: true,
            conditionKind: true,
            inputBindings: true,
            fromInvocation: { select: { planId: true } },
          },
        },
      },
    });
    if (!target || target.plan.userId !== input.actorUserId) throw new ArtifactNotFoundError();

    const resolved: ResolvedArtifactInput[] = [];
    const inputNames = new Set<string>();

    for (const dependency of target.incomingDependencies) {
      const bindings = parseInputBindings(dependency.inputBindings);
      if (bindings.length === 0) continue;
      if (dependency.conditionKind !== "DATA") {
        throw new ArtifactBindingError(`Dependency ${dependency.id} carries input bindings but is not DATA`);
      }
      if (
        dependency.planId !== target.plan.id ||
        dependency.toInvocationId !== target.id ||
        dependency.fromInvocation.planId !== target.plan.id
      ) {
        throw new ArtifactBindingError("Cross-plan artifact dependency is not allowed");
      }

      for (const binding of bindings) {
        if (inputNames.has(binding.inputName)) {
          throw new ArtifactBindingError(`Duplicate resolved input ${JSON.stringify(binding.inputName)}`);
        }
        inputNames.add(binding.inputName);

        const artifact = await this.prisma.artifact.findUnique({
          where: {
            creatorInvocationId_outputName: {
              creatorInvocationId: dependency.fromInvocationId,
              outputName: binding.sourceOutputName,
            },
          },
          include: { versions: { orderBy: { version: "desc" }, take: 1 } },
        });
        if (!artifact) {
          throw new ArtifactBindingError(
            `Missing artifact ${JSON.stringify(binding.sourceOutputName)} from invocation ${dependency.fromInvocationId}`,
          );
        }
        const artifactType = parseArtifactType(artifact.type);
        if (artifactType !== binding.expectedArtifactType) {
          throw new ArtifactBindingError(
            `Input ${JSON.stringify(binding.inputName)} expected ${binding.expectedArtifactType}, received ${artifactType}`,
          );
        }
        const version = artifact.versions[0];
        if (!version) throw new ArtifactBindingError(`Artifact ${artifact.id} has no immutable version`);

        resolved.push({
          inputName: binding.inputName,
          expectedType: binding.expectedArtifactType,
          dependencyId: dependency.id,
          sourceInvocationId: dependency.fromInvocationId,
          reference: toReference(artifact, version),
        });
      }
    }

    return resolved.sort((left, right) => left.inputName.localeCompare(right.inputName));
  }
}

function validateIdentifier(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) {
    throw new ArtifactValidationError(`${field} must be a non-empty bounded string`);
  }
}

function validateName(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_NAME_LENGTH) {
    throw new ArtifactValidationError(`${field} must be between 1 and ${MAX_NAME_LENGTH} characters`);
  }
  return normalized;
}

function validateClassification(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_CLASSIFICATION_LENGTH) {
    throw new ArtifactValidationError(
      `classification must be between 1 and ${MAX_CLASSIFICATION_LENGTH} characters`,
    );
  }
  return normalized;
}

function validateArtifactType(value: string): asserts value is ArtifactType {
  if (!ARTIFACT_TYPES.includes(value as ArtifactType)) {
    throw new ArtifactValidationError(`Unsupported artifact type ${JSON.stringify(value)}`);
  }
}

function parseArtifactType(value: string): ArtifactType {
  validateArtifactType(value);
  return value;
}

function validateContent(content: ArtifactContent): void {
  if (content.kind === "CONTENT_REF") {
    const ref = content.ref.trim();
    if (ref.length === 0 || ref.length > MAX_CONTENT_REF_LENGTH) {
      throw new ArtifactValidationError(`contentRef must be between 1 and ${MAX_CONTENT_REF_LENGTH} characters`);
    }
    return;
  }
  const canonical = canonicalJson(content.value);
  if (Buffer.byteLength(canonical, "utf8") > MAX_INLINE_JSON_BYTES) {
    throw new ArtifactValidationError(`Inline artifact content exceeds ${MAX_INLINE_JSON_BYTES} bytes`);
  }
}

function validateMetadata(value: Prisma.InputJsonValue | undefined, field: string): void {
  if (value === undefined) return;
  const canonical = canonicalJson(value);
  if (Buffer.byteLength(canonical, "utf8") > MAX_METADATA_JSON_BYTES) {
    throw new ArtifactValidationError(`${field} exceeds ${MAX_METADATA_JSON_BYTES} bytes`);
  }
}

function contentWriteData(content: ArtifactContent): { contentRef?: string; contentJson?: Prisma.InputJsonValue } {
  return content.kind === "CONTENT_REF"
    ? { contentRef: content.ref.trim() }
    : { contentJson: content.value };
}

function storedContent(version: Pick<StoredVersionShape, "contentRef" | "contentJson">): ArtifactContent {
  if (version.contentRef !== null) return { kind: "CONTENT_REF", ref: version.contentRef };
  if (version.contentJson !== null) {
    return { kind: "INLINE_JSON", value: version.contentJson as Prisma.InputJsonValue };
  }
  throw new ArtifactConflictError("Artifact version has no content");
}

function toReference(artifact: StoredArtifactShape, version: StoredVersionShape): ArtifactReference {
  return {
    artifactId: artifact.id,
    artifactVersionId: version.id,
    outputName: artifact.outputName,
    type: parseArtifactType(artifact.type),
    classification: artifact.classification,
    version: version.version,
    fingerprint: version.fingerprint,
  };
}

function isReadableBy(
  artifact: {
    creatorInvocation: { plan: { userId: string } };
    accessGrants: readonly { id: string }[];
  },
  actorUserId: string,
): boolean {
  return artifact.creatorInvocation.plan.userId === actorUserId || artifact.accessGrants.length > 0;
}

function findDeclaredOutputType(outputDeclarations: Prisma.JsonValue, outputName: string): ArtifactType | null {
  if (!Array.isArray(outputDeclarations)) {
    throw new ArtifactValidationError("Invocation output declarations are malformed");
  }
  for (const entry of outputDeclarations) {
    if (!isRecord(entry)) continue;
    if (entry.name !== outputName || typeof entry.artifactType !== "string") continue;
    return parseArtifactType(entry.artifactType);
  }
  return null;
}

function parseInputBindings(value: Prisma.JsonValue): Array<{
  inputName: string;
  sourceOutputName: string;
  expectedArtifactType: ArtifactType;
}> {
  if (!Array.isArray(value)) throw new ArtifactBindingError("Dependency inputBindings must be an array");
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new ArtifactBindingError(`inputBindings[${index}] must be an object`);
    const inputName = readBoundedString(entry.inputName, `inputBindings[${index}].inputName`);
    const sourceOutputName = readBoundedString(
      entry.sourceOutputName,
      `inputBindings[${index}].sourceOutputName`,
    );
    if (typeof entry.expectedArtifactType !== "string") {
      throw new ArtifactBindingError(`inputBindings[${index}].expectedArtifactType must be a string`);
    }
    let expectedArtifactType: ArtifactType;
    try {
      expectedArtifactType = parseArtifactType(entry.expectedArtifactType);
    } catch {
      throw new ArtifactBindingError(`inputBindings[${index}].expectedArtifactType is unsupported`);
    }
    return { inputName, sourceOutputName, expectedArtifactType };
  });
}

function readBoundedString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new ArtifactBindingError(`${field} must be a string`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_NAME_LENGTH) {
    throw new ArtifactBindingError(`${field} must be a non-empty bounded string`);
  }
  return normalized;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
