import type { Prisma } from "@vimla/database";

export const ARTIFACT_TYPES = [
  "TEXT",
  "PROMPT",
  "DOCUMENT",
  "CODE",
  "IMAGE",
  "FILE",
  "PLAN",
  "PATCH",
  "JSON",
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const ARTIFACT_READ_PERMISSION = "READ" as const;
export type ArtifactPermission = typeof ARTIFACT_READ_PERMISSION;

export type ArtifactContent =
  | { kind: "CONTENT_REF"; ref: string }
  | { kind: "INLINE_JSON"; value: Prisma.InputJsonValue };

export interface CreateArtifactInput {
  actorUserId: string;
  creatorInvocationId: string;
  outputName: string;
  type: ArtifactType;
  classification: string;
  content: ArtifactContent;
  metadata?: Prisma.InputJsonValue;
  versionMetadata?: Prisma.InputJsonValue;
}

export interface CreateArtifactVersionInput {
  actorUserId: string;
  artifactId: string;
  expectedCurrentVersion: number;
  content: ArtifactContent;
  metadata?: Prisma.InputJsonValue;
}

export interface ArtifactReference {
  artifactId: string;
  artifactVersionId: string;
  outputName: string;
  type: ArtifactType;
  classification: string;
  version: number;
  fingerprint: string;
}

export interface ResolvedArtifactInput {
  inputName: string;
  expectedType: ArtifactType;
  dependencyId: string;
  sourceInvocationId: string;
  reference: ArtifactReference;
}

export interface ReadArtifactVersionResult extends ArtifactReference {
  creatorInvocationId: string;
  planId: string;
  content: ArtifactContent;
  artifactMetadata: Prisma.JsonValue | null;
  versionMetadata: Prisma.JsonValue | null;
}

export interface ArtifactProvenance {
  reference: ArtifactReference;
  creatorInvocationId: string;
  planId: string;
  planVersion: number;
  planHash: string;
  messageId: string;
  conversationId: string;
}
