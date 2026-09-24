import type { Prisma } from "@vimla/database";

export type ContextSourceType =
  | "USER_MESSAGE"
  | "CONVERSATION"
  | "MESSAGE"
  | "E2EE_DISCLOSURE"
  | "PARTICIPANT"
  | "PROJECT"
  | "WORKSPACE_OBJECT"
  | "ATTACHMENT"
  | "FILE_METADATA"
  | "ARTIFACT"
  | "COMPACTED_STATE"
  | "MEMORY"
  | "ENTITY"
  | "LOCALE_TIMEZONE"
  | "AUDIENCE";

export type ContextClassification = "PUBLIC" | "INTERNAL" | "PRIVATE" | "RESTRICTED";

export interface ContextSnapshotItemInput {
  sourceType: ContextSourceType;
  sourceId: string;
  sourceVersion?: string | null;
  classification: ContextClassification;
  contentRef?: string | null;
  metadata?: Prisma.InputJsonValue | null;
}

export interface ContextSnapshotItemView {
  id: string;
  sequence: number;
  sourceType: ContextSourceType;
  sourceId: string;
  sourceVersion: string | null;
  classification: ContextClassification;
  contentRef: string | null;
  metadata: Prisma.JsonValue | null;
  fingerprint: string;
  createdAt: string;
}

export interface ContextSnapshotView {
  id: string;
  planId: string;
  version: number;
  fingerprint: string;
  createdAt: string;
  items: ContextSnapshotItemView[];
}

export interface CreateContextSnapshotInput {
  actorUserId: string;
  planId: string;
  items: readonly ContextSnapshotItemInput[];
}

export interface CreateExecutionPlanSnapshotInput {
  actorUserId: string;
  planId: string;
}

export interface ResolveInvocationContextInput {
  actorUserId: string;
  invocationId: string;
}

export interface ContextAccessCheck {
  actorUserId: string;
  sourceType: ContextSourceType;
  sourceId: string;
}

export type ContextAccessVerifier = (check: ContextAccessCheck) => Promise<boolean>;
