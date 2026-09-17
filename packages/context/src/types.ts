import type { Prisma } from "@vimla/database";

export type ContextSourceType =
  | "USER_MESSAGE"
  | "CONVERSATION"
  | "MESSAGE"
  | "PARTICIPANT"
  | "PROJECT"
  | "WORKSPACE_OBJECT"
  | "ATTACHMENT"
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

export interface ContextSnapshotItemView extends ContextSnapshotItemInput {
  id: string;
  sequence: number;
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

export interface ContextAccessCheck {
  actorUserId: string;
  sourceType: ContextSourceType;
  sourceId: string;
}

export type ContextAccessVerifier = (check: ContextAccessCheck) => Promise<boolean>;
