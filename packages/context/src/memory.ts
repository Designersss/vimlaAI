import { createHash, randomUUID } from "node:crypto";
import { ArtifactService } from "@vimla/artifacts";
import { Prisma, type PrismaClient } from "@vimla/database";
import { containsSensitiveContextData } from "./packer.js";

export const MEMORY_SCOPE_KINDS = [
  "PERSONAL",
  "PROJECT",
  "CONVERSATION",
  "THREAD",
] as const;
export type MemoryScopeKind = (typeof MEMORY_SCOPE_KINDS)[number];

export const MEMORY_TYPES = [
  "USER_FACT",
  "USER_PREFERENCE",
  "USER_GOAL",
  "USER_RELATIONSHIP",
  "PROJECT_FACT",
  "PROJECT_DECISION",
  "PROJECT_STATE",
  "CONVERSATION_STATE",
  "THREAD_STATE",
  "DECISION",
  "ENTITY_RELATION",
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_ORIGINS = [
  "AUTO_EXTRACTION",
  "USER_EXPLICIT",
  "USER_CORRECTION",
  "E2EE_USER_DISCLOSURE",
] as const;
export type MemoryOrigin = (typeof MEMORY_ORIGINS)[number];

export type MemoryClassification =
  | "PUBLIC"
  | "INTERNAL"
  | "PRIVATE"
  | "RESTRICTED";
export type MemorySensitivity = "NORMAL" | "SENSITIVE";

export type MemoryScope =
  | { kind: "PERSONAL" }
  | { kind: "PROJECT"; projectId: string }
  | { kind: "CONVERSATION"; conversationId: string }
  | { kind: "THREAD"; threadId: string };

export interface MemorySourceRefInput {
  provenance: MemoryOrigin;
  sourceType:
    | "MESSAGE"
    | "WORKSPACE_OBJECT"
    | "PROJECT"
    | "ARTIFACT"
    | "USER_EXPLICIT"
    | "USER_CORRECTION"
    | "E2EE_USER_DISCLOSURE";
  sourceId: string;
  sourceVersion?: string | null;
  sourceScopeKind:
    | MemoryScopeKind
    | "DIRECT_CHAT";
  sourceScopeId?: string | null;
  disclosedAt?: Date | null;
}

export interface MemoryCandidateInput {
  actorUserId: string;
  scope: MemoryScope;
  type: MemoryType;
  slotKey: string;
  content: string;
  classification?: MemoryClassification;
  sensitivity?: MemorySensitivity;
  confidence?: number;
  quality?: number;
  validFrom?: Date;
  expiresAt?: Date | null;
  origin: MemoryOrigin;
  sourceRefs: readonly MemorySourceRefInput[];
  explicitCrossScopeWrite?: boolean;
  userConfirmed?: boolean;
  userCorrected?: boolean;
  expectedCurrentId?: string;
}

export interface MemoryListPage {
  items: MemoryView[];
  nextCursor: string | null;
}

export interface MemoryView {
  id: string;
  scopeKind: MemoryScopeKind;
  projectId: string | null;
  conversationId: string | null;
  threadId: string | null;
  type: MemoryType;
  slotKey: string;
  content: string;
  classification: MemoryClassification;
  sensitivity: MemorySensitivity;
  confidence: number;
  quality: number;
  origin: MemoryOrigin;
  state: "ACTIVE" | "SUPERSEDED" | "INVALIDATED";
  validFrom: string;
  expiresAt: string | null;
  userConfirmedAt: string | null;
  userCorrectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MemoryErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "SENSITIVE_CONTENT"
  | "DISABLED";

const MEMORY_HTTP_STATUS: Record<MemoryErrorCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  SENSITIVE_CONTENT: 400,
  DISABLED: 503,
};

export class MemoryError extends Error {
  readonly httpStatus: number;

  constructor(
    readonly code: MemoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MemoryError";
    this.httpStatus = MEMORY_HTTP_STATUS[code];
  }
}

export function isMemoryError(
  error: unknown,
): error is MemoryError {
  return error instanceof MemoryError;
}

type MemoryRow = Prisma.MemoryItemGetPayload<{
  include: { sourceRefs: true };
}>;

export class MemoryService {
  constructor(private readonly db: PrismaClient) {}

  async rememberPersonal(input: {
    actorUserId: string;
    type: MemoryType;
    slotKey: string;
    content: string;
    expiresAt?: Date | null;
  }): Promise<MemoryView> {
    const id = randomUUID();
    return this.ingestCandidate({
      actorUserId: input.actorUserId,
      scope: { kind: "PERSONAL" },
      type: input.type,
      slotKey: input.slotKey,
      content: input.content,
      origin: "USER_EXPLICIT",
      classification: "PRIVATE",
      sensitivity: "NORMAL",
      confidence: 1,
      quality: 1,
      expiresAt: input.expiresAt,
      userConfirmed: true,
      sourceRefs: [
        {
          provenance: "USER_EXPLICIT",
          sourceType: "USER_EXPLICIT",
          sourceId: id,
          sourceScopeKind: "PERSONAL",
          sourceScopeId: input.actorUserId,
          disclosedAt: new Date(),
        },
      ],
    });
  }

  async correctPersonal(
    actorUserId: string,
    memoryId: string,
    input: {
      content: string;
      expiresAt?: Date | null;
    },
  ): Promise<MemoryView> {
    const current = await this.db.memoryItem.findFirst({
      where: {
        id: memoryId,
        ownerUserId: actorUserId,
        scopeKind: "PERSONAL",
        state: "ACTIVE",
      },
      include: { sourceRefs: true },
    });
    if (!current) {
      throw new MemoryError("NOT_FOUND", "Memory item not found");
    }

    return this.ingestCandidate({
      actorUserId,
      scope: { kind: "PERSONAL" },
      type: parseMemoryType(current.type),
      slotKey: current.slotKey,
      content: input.content,
      origin: "USER_CORRECTION",
      classification: parseClassification(current.classification),
      sensitivity: parseSensitivity(current.sensitivity),
      confidence: 1,
      quality: 1,
      validFrom: new Date(),
      expiresAt:
        input.expiresAt === undefined
          ? current.expiresAt
          : input.expiresAt,
      userConfirmed: true,
      userCorrected: true,
      expectedCurrentId: current.id,
      sourceRefs: [
        {
          provenance: "USER_CORRECTION",
          sourceType: "USER_CORRECTION",
          sourceId: current.id,
          sourceVersion: current.updatedAt.toISOString(),
          sourceScopeKind: "PERSONAL",
          sourceScopeId: actorUserId,
          disclosedAt: new Date(),
        },
      ],
    });
  }

  async invalidatePersonal(
    actorUserId: string,
    memoryId: string,
    reason = "USER_DELETED",
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "memory_item"
        WHERE "id"=${memoryId}
          AND "ownerUserId"=${actorUserId}
          AND "scopeKind"='PERSONAL'
        FOR UPDATE
      `);
      if (locked.length === 0) {
        throw new MemoryError("NOT_FOUND", "Memory item not found");
      }
      const current = await tx.memoryItem.findUnique({
        where: { id: memoryId },
      });
      if (!current) {
        throw new MemoryError("NOT_FOUND", "Memory item not found");
      }
      if (current.state === "INVALIDATED") return;
      if (current.state !== "ACTIVE") {
        throw new MemoryError(
          "CONFLICT",
          "Only the current memory item can be deleted",
        );
      }
      await tx.memoryItem.update({
        where: { id: memoryId },
        data: {
          state: "INVALIDATED",
          invalidatedAt: new Date(),
          invalidationReason: reason,
        },
      });
    });
  }

  async promoteE2eeDisclosure(input: {
    actorUserId: string;
    directConversationId: string;
    sourceMessageId: string;
    type: MemoryType;
    slotKey: string;
    content: string;
    expiresAt?: Date | null;
  }): Promise<MemoryView> {
    const disclosedAt = new Date();
    const source = await this.db.directMessage.findFirst({
      where: {
        id: input.sourceMessageId,
        conversationId: input.directConversationId,
        conversation: {
          members: {
            some: { userId: input.actorUserId },
          },
        },
      },
      select: {
        id: true,
        createdAt: true,
      },
    });
    if (!source) {
      throw new MemoryError(
        "NOT_FOUND",
        "Direct Chat disclosure source not found",
      );
    }

    return this.ingestCandidate({
      actorUserId: input.actorUserId,
      scope: { kind: "PERSONAL" },
      type: input.type,
      slotKey: input.slotKey,
      content: input.content,
      origin: "E2EE_USER_DISCLOSURE",
      classification: "PRIVATE",
      sensitivity: "NORMAL",
      confidence: 1,
      quality: 1,
      validFrom: disclosedAt,
      expiresAt: input.expiresAt,
      userConfirmed: true,
      sourceRefs: [
        {
          provenance: "E2EE_USER_DISCLOSURE",
          sourceType: "E2EE_USER_DISCLOSURE",
          sourceId: source.id,
          sourceVersion: source.createdAt.toISOString(),
          sourceScopeKind: "DIRECT_CHAT",
          sourceScopeId: input.directConversationId,
          disclosedAt,
        },
      ],
    });
  }

  async listPersonal(
    actorUserId: string,
    input: { limit: number; cursor?: string },
  ): Promise<MemoryListPage> {
    const now = new Date();
    const cursor = input.cursor
      ? decodeCursor(input.cursor)
      : null;
    const rows = await this.db.memoryItem.findMany({
      where: {
        ownerUserId: actorUserId,
        scopeKind: "PERSONAL",
        state: "ACTIVE",
        invalidatedAt: null,
        AND: [
          {
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: now } },
            ],
          },
          ...(cursor
            ? [
                {
                  OR: [
                    { validFrom: { lt: cursor.validFrom } },
                    {
                      validFrom: cursor.validFrom,
                      id: { lt: cursor.id },
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      include: { sourceRefs: true },
      orderBy: [{ validFrom: "desc" }, { id: "desc" }],
      take: input.limit + 1,
    });

    const visible: MemoryView[] = [];
    for (const row of rows) {
      if (visible.length >= input.limit) break;
      if (!(await ensureMemoryCurrent(this.db, row))) continue;
      visible.push(toMemoryView(row));
    }
    const last = visible.at(-1);
    return {
      items: visible,
      nextCursor:
        rows.length > input.limit && last
          ? encodeCursor(last.validFrom, last.id)
          : null,
    };
  }

  async getPersonal(
    actorUserId: string,
    memoryId: string,
  ): Promise<MemoryView> {
    const row = await this.db.memoryItem.findFirst({
      where: {
        id: memoryId,
        ownerUserId: actorUserId,
        scopeKind: "PERSONAL",
        state: "ACTIVE",
      },
      include: { sourceRefs: true },
    });
    if (!row || !(await ensureMemoryCurrent(this.db, row))) {
      throw new MemoryError("NOT_FOUND", "Memory item not found");
    }
    return toMemoryView(row);
  }

  async ingestCandidate(
    input: MemoryCandidateInput,
  ): Promise<MemoryView> {
    validateCandidate(input);
    const scope = normalizeScope(input.actorUserId, input.scope);
    const slotKey = normalizeSlotKey(input.slotKey);
    const content = input.content.trim();
    const contentHash = hashText(content);
    const validFrom = input.validFrom ?? new Date();
    const expiresAt = input.expiresAt ?? null;
    const classification = input.classification ?? "PRIVATE";
    const sensitivity = input.sensitivity ?? "NORMAL";
    const confidence = input.confidence ?? 0.8;
    const quality = input.quality ?? 0.8;

    const created = await this.db.$transaction(async (tx) => {
      await assertScopeWritable(
        tx,
        input.actorUserId,
        scope,
        input.type,
      );
      await assertSourceRefsValid(
        tx,
        input.actorUserId,
        scope,
        input.sourceRefs,
        input.explicitCrossScopeWrite === true,
      );

      await tx.$queryRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(
          hashtext(${scope.scopeKey + "\u0000" + slotKey})
        )
      `);
      const active = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "memory_item"
        WHERE "scopeKey"=${scope.scopeKey}
          AND "slotKey"=${slotKey}
          AND "state"='ACTIVE'
        FOR UPDATE
      `);
      const existing = active[0]
        ? await tx.memoryItem.findUnique({
            where: { id: active[0].id },
            include: { sourceRefs: true },
          })
        : null;

      if (
        input.expectedCurrentId &&
        existing?.id !== input.expectedCurrentId
      ) {
        throw new MemoryError(
          "CONFLICT",
          "Memory changed before the correction was applied",
        );
      }

      if (
        existing &&
        existing.contentHash === contentHash &&
        existing.type === input.type
      ) {
        const refreshed = await tx.memoryItem.update({
          where: { id: existing.id },
          data: {
            userConfirmedAt:
              input.userConfirmed === true
                ? new Date()
                : existing.userConfirmedAt,
            quality: Math.max(existing.quality, quality),
            confidence: Math.max(existing.confidence, confidence),
          },
          include: { sourceRefs: true },
        });
        return refreshed;
      }

      if (
        existing &&
        input.origin === "AUTO_EXTRACTION" &&
        (existing.userConfirmedAt ||
          existing.userCorrectedAt ||
          existing.origin === "USER_EXPLICIT" ||
          existing.origin === "USER_CORRECTION" ||
          existing.origin === "E2EE_USER_DISCLOSURE")
      ) {
        return existing;
      }

      if (
        existing &&
        input.origin === "AUTO_EXTRACTION" &&
        existing.validFrom > validFrom
      ) {
        return existing;
      }

      if (existing) {
        await tx.memoryItem.update({
          where: { id: existing.id },
          data: { state: "SUPERSEDED" },
        });
      }

      const memoryId = randomUUID();
      const refs =
        input.sourceRefs.length > 0
          ? input.sourceRefs
          : [
              {
                provenance: input.origin,
                sourceType: "USER_EXPLICIT" as const,
                sourceId: memoryId,
                sourceScopeKind: "PERSONAL" as const,
                sourceScopeId: input.actorUserId,
                disclosedAt: new Date(),
              },
            ];

      return tx.memoryItem.create({
        data: {
          id: memoryId,
          ownerUserId: input.actorUserId,
          scopeKind: scope.kind,
          scopeKey: scope.scopeKey,
          projectId: scope.projectId,
          conversationId: scope.conversationId,
          threadId: scope.threadId,
          type: input.type,
          slotKey,
          content,
          contentHash,
          classification,
          sensitivity,
          confidence,
          quality,
          generation: existing ? existing.generation + 1 : 1,
          origin: input.origin,
          state: "ACTIVE",
          validFrom,
          expiresAt,
          supersedesId: existing?.id ?? null,
          userConfirmedAt:
            input.userConfirmed === true ? new Date() : null,
          userCorrectedAt:
            input.userCorrected === true ? new Date() : null,
          sourceRefs: {
            create: refs.map((ref) => ({
              provenance: ref.provenance,
              sourceType: ref.sourceType,
              sourceId: ref.sourceId,
              sourceVersion: ref.sourceVersion ?? null,
              sourceScopeKind: ref.sourceScopeKind,
              sourceScopeId: ref.sourceScopeId ?? null,
              disclosedAt: ref.disclosedAt ?? null,
            })),
          },
        },
        include: { sourceRefs: true },
      });
    });

    return toMemoryView(created);
  }
}

export async function canReadMemoryItem(
  db: PrismaClient,
  actorUserId: string,
  memoryId: string,
): Promise<boolean> {
  const row = await db.memoryItem.findUnique({
    where: { id: memoryId },
    include: { sourceRefs: true },
  });
  if (!row) return false;
  if (!(await memoryScopeReadable(db, actorUserId, row))) {
    return false;
  }
  return ensureMemoryCurrent(db, row);
}

export async function ensureMemoryCurrent(
  db: PrismaClient,
  row: MemoryRow,
): Promise<boolean> {
  if (
    row.state !== "ACTIVE" ||
    row.invalidatedAt !== null
  ) {
    return false;
  }
  if (row.expiresAt && row.expiresAt <= new Date()) {
    await invalidateIfActive(db, row.id, "EXPIRED");
    return false;
  }

  for (const ref of row.sourceRefs) {
    if (!(await sourceRefCurrent(db, row.ownerUserId, ref))) {
      await invalidateIfActive(
        db,
        row.id,
        "SOURCE_STALE_OR_INACCESSIBLE",
      );
      return false;
    }
  }
  return true;
}

export function toMemoryView(row: {
  id: string;
  scopeKind: string;
  projectId: string | null;
  conversationId: string | null;
  threadId: string | null;
  type: string;
  slotKey: string;
  content: string;
  classification: string;
  sensitivity: string;
  confidence: number;
  quality: number;
  origin: string;
  state: string;
  validFrom: Date;
  expiresAt: Date | null;
  userConfirmedAt: Date | null;
  userCorrectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): MemoryView {
  return {
    id: row.id,
    scopeKind: parseScopeKind(row.scopeKind),
    projectId: row.projectId,
    conversationId: row.conversationId,
    threadId: row.threadId,
    type: parseMemoryType(row.type),
    slotKey: row.slotKey,
    content: row.content,
    classification: parseClassification(row.classification),
    sensitivity: parseSensitivity(row.sensitivity),
    confidence: row.confidence,
    quality: row.quality,
    origin: parseOrigin(row.origin),
    state: parseState(row.state),
    validFrom: row.validFrom.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    userConfirmedAt:
      row.userConfirmedAt?.toISOString() ?? null,
    userCorrectedAt:
      row.userCorrectedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function memoryScopeReadable(
  db: PrismaClient,
  actorUserId: string,
  row: {
    ownerUserId: string;
    scopeKind: string;
    projectId: string | null;
    conversationId: string | null;
    threadId: string | null;
  },
): Promise<boolean> {
  switch (row.scopeKind) {
    case "PERSONAL":
      return row.ownerUserId === actorUserId;
    case "CONVERSATION":
      if (!row.conversationId || row.ownerUserId !== actorUserId) {
        return false;
      }
      return Boolean(
        await db.conversation.findFirst({
          where: {
            id: row.conversationId,
            userId: actorUserId,
          },
          select: { id: true },
        }),
      );
    case "THREAD":
      return row.ownerUserId === actorUserId && Boolean(row.threadId);
    case "PROJECT":
      if (!row.projectId) return false;
      return Boolean(
        await db.project.findFirst({
          where: {
            id: row.projectId,
            OR: [
              { ownerUserId: actorUserId },
              { members: { some: { userId: actorUserId } } },
            ],
          },
          select: { id: true },
        }),
      );
    default:
      return false;
  }
}

async function assertScopeWritable(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  scope: NormalizedScope,
  type: MemoryType,
): Promise<void> {
  assertTypeMatchesScope(scope.kind, type);
  switch (scope.kind) {
    case "PERSONAL":
    case "THREAD":
      return;
    case "CONVERSATION": {
      const conversation = await tx.conversation.findFirst({
        where: {
          id: scope.conversationId ?? "",
          userId: actorUserId,
        },
        select: { id: true },
      });
      if (!conversation) {
        throw new MemoryError(
          "NOT_FOUND",
          "Conversation memory scope not found",
        );
      }
      return;
    }
    case "PROJECT": {
      const project = await tx.project.findFirst({
        where: {
          id: scope.projectId ?? "",
          OR: [
            { ownerUserId: actorUserId },
            { members: { some: { userId: actorUserId } } },
          ],
        },
        select: { id: true },
      });
      if (!project) {
        throw new MemoryError(
          "NOT_FOUND",
          "Project memory scope not found",
        );
      }
      return;
    }
  }
}

async function assertSourceRefsValid(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  targetScope: NormalizedScope,
  refs: readonly MemorySourceRefInput[],
  explicitCrossScopeWrite: boolean,
): Promise<void> {
  if (refs.length === 0) return;
  if (refs.length > 32) {
    throw new MemoryError(
      "VALIDATION_ERROR",
      "Too many memory source references",
    );
  }

  for (const ref of refs) {
    if (
      targetScope.kind === "PROJECT" &&
      !(
        ref.sourceScopeKind === "PROJECT" &&
        ref.sourceScopeId === targetScope.projectId
      ) &&
      !explicitCrossScopeWrite
    ) {
      throw new MemoryError(
        "FORBIDDEN",
        "Project memory requires an explicit cross-scope write",
      );
    }
    await assertSourceRefValid(
      tx,
      actorUserId,
      ref,
    );
  }
}

async function assertSourceRefValid(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  ref: MemorySourceRefInput,
): Promise<void> {
  switch (ref.sourceType) {
    case "USER_EXPLICIT":
      return;
    case "USER_CORRECTION": {
      const row = await tx.memoryItem.findFirst({
        where: {
          id: ref.sourceId,
          ownerUserId: actorUserId,
        },
        select: { id: true },
      });
      if (!row) {
        throw new MemoryError(
          "VALIDATION_ERROR",
          "Correction source is invalid",
        );
      }
      return;
    }
    case "MESSAGE": {
      const row = await tx.message.findFirst({
        where: {
          id: ref.sourceId,
          conversation: { userId: actorUserId },
        },
        select: {
          updatedAt: true,
          conversationId: true,
        },
      });
      if (
        !row ||
        !versionMatches(
          ref.sourceVersion,
          row.updatedAt.toISOString(),
        )
      ) {
        throw new MemoryError(
          "VALIDATION_ERROR",
          "Message memory source is stale or inaccessible",
        );
      }
      if (
        ref.sourceScopeKind === "CONVERSATION" &&
        ref.sourceScopeId !== row.conversationId
      ) {
        throw new MemoryError(
          "VALIDATION_ERROR",
          "Message memory source scope is invalid",
        );
      }
      return;
    }
    case "WORKSPACE_OBJECT": {
      const row = await tx.workspaceObject.findFirst({
        where: {
          id: ref.sourceId,
          personalOwnerUserId: actorUserId,
          deletedAt: null,
        },
        select: { updatedAt: true },
      });
      if (
        !row ||
        !versionMatches(
          ref.sourceVersion,
          row.updatedAt.toISOString(),
        )
      ) {
        throw new MemoryError(
          "VALIDATION_ERROR",
          "Workspace memory source is stale or inaccessible",
        );
      }
      return;
    }
    case "PROJECT": {
      const row = await tx.project.findFirst({
        where: {
          id: ref.sourceId,
          OR: [
            { ownerUserId: actorUserId },
            { members: { some: { userId: actorUserId } } },
          ],
        },
        select: { updatedAt: true },
      });
      if (
        !row ||
        !versionMatches(
          ref.sourceVersion,
          row.updatedAt.toISOString(),
        )
      ) {
        throw new MemoryError(
          "VALIDATION_ERROR",
          "Project memory source is stale or inaccessible",
        );
      }
      return;
    }
    case "ARTIFACT": {
      const row = await tx.artifact.findFirst({
        where: {
          id: ref.sourceId,
          OR: [
            {
              creatorInvocation: {
                plan: { userId: actorUserId },
              },
            },
            {
              accessGrants: {
                some: {
                  granteeUserId: actorUserId,
                  permission: "READ",
                  revokedAt: null,
                },
              },
            },
          ],
        },
        select: {
          id: true,
          versions: {
            select: { id: true },
            orderBy: { version: "desc" },
            take: 1,
          },
        },
      });
      if (
        !row ||
        (ref.sourceVersion &&
          row.versions[0]?.id !== ref.sourceVersion)
      ) {
        throw new MemoryError(
          "VALIDATION_ERROR",
          "Artifact memory source is stale or inaccessible",
        );
      }
      return;
    }
    case "E2EE_USER_DISCLOSURE": {
      const row = await tx.directMessage.findFirst({
        where: {
          id: ref.sourceId,
          ...(ref.sourceScopeId
            ? { conversationId: ref.sourceScopeId }
            : {}),
          conversation: {
            members: {
              some: { userId: actorUserId },
            },
          },
        },
        select: { createdAt: true },
      });
      if (
        !row ||
        !versionMatches(
          ref.sourceVersion,
          row.createdAt.toISOString(),
        )
      ) {
        throw new MemoryError(
          "VALIDATION_ERROR",
          "E2EE disclosure provenance is invalid",
        );
      }
      return;
    }
  }
}

async function sourceRefCurrent(
  db: PrismaClient,
  memoryOwnerUserId: string,
  ref: {
    sourceType: string;
    sourceId: string;
    sourceVersion: string | null;
    sourceScopeKind: string;
    sourceScopeId: string | null;
  },
): Promise<boolean> {
  switch (ref.sourceType) {
    case "USER_EXPLICIT":
    case "USER_CORRECTION":
    case "E2EE_USER_DISCLOSURE":
      return true;
    case "MESSAGE": {
      const row = await db.message.findFirst({
        where: {
          id: ref.sourceId,
          conversation: { userId: memoryOwnerUserId },
        },
        select: { updatedAt: true },
      });
      return Boolean(
        row &&
          versionMatches(
            ref.sourceVersion,
            row.updatedAt.toISOString(),
          ),
      );
    }
    case "WORKSPACE_OBJECT": {
      const row = await db.workspaceObject.findFirst({
        where: {
          id: ref.sourceId,
          personalOwnerUserId: memoryOwnerUserId,
          deletedAt: null,
        },
        select: { updatedAt: true },
      });
      return Boolean(
        row &&
          versionMatches(
            ref.sourceVersion,
            row.updatedAt.toISOString(),
          ),
      );
    }
    case "PROJECT": {
      const row = await db.project.findFirst({
        where: {
          id: ref.sourceId,
          OR: [
            { ownerUserId: memoryOwnerUserId },
            {
              members: {
                some: { userId: memoryOwnerUserId },
              },
            },
          ],
        },
        select: { updatedAt: true },
      });
      return Boolean(
        row &&
          versionMatches(
            ref.sourceVersion,
            row.updatedAt.toISOString(),
          ),
      );
    }
    case "ARTIFACT": {
      if (!ref.sourceVersion) return false;
      try {
        return await new ArtifactService(db).canReadVersion({
          actorUserId: memoryOwnerUserId,
          artifactVersionId: ref.sourceVersion,
        });
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

async function invalidateIfActive(
  db: PrismaClient,
  memoryId: string,
  reason: string,
): Promise<void> {
  await db.memoryItem.updateMany({
    where: {
      id: memoryId,
      state: "ACTIVE",
    },
    data: {
      state: "INVALIDATED",
      invalidatedAt: new Date(),
      invalidationReason: reason,
    },
  });
}

function validateCandidate(
  input: MemoryCandidateInput,
): void {
  if (!MEMORY_TYPES.includes(input.type)) {
    throw new MemoryError(
      "VALIDATION_ERROR",
      "Unknown memory type",
    );
  }
  const content = input.content.trim();
  if (content.length < 1 || content.length > 4_000) {
    throw new MemoryError(
      "VALIDATION_ERROR",
      "Memory content is invalid",
    );
  }
  if (containsSensitiveContextData({ content })) {
    throw new MemoryError(
      "SENSITIVE_CONTENT",
      "Secret-like content cannot be stored in Memory",
    );
  }
  const slotKey = normalizeSlotKey(input.slotKey);
  if (slotKey.length < 1 || slotKey.length > 128) {
    throw new MemoryError(
      "VALIDATION_ERROR",
      "Memory slot key is invalid",
    );
  }
  const confidence = input.confidence ?? 0.8;
  const quality = input.quality ?? 0.8;
  if (
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1 ||
    !Number.isFinite(quality) ||
    quality < 0 ||
    quality > 1
  ) {
    throw new MemoryError(
      "VALIDATION_ERROR",
      "Memory quality scores are invalid",
    );
  }
  const validFrom = input.validFrom ?? new Date();
  if (
    input.expiresAt &&
    input.expiresAt <= validFrom
  ) {
    throw new MemoryError(
      "VALIDATION_ERROR",
      "Memory expiry must be after valid-from",
    );
  }
  if (
    (input.sensitivity ?? "NORMAL") === "SENSITIVE" &&
    (input.classification ?? "PRIVATE") !== "RESTRICTED"
  ) {
    throw new MemoryError(
      "VALIDATION_ERROR",
      "Sensitive memory must be RESTRICTED",
    );
  }
  if (input.origin === "AUTO_EXTRACTION") {
    if (input.sourceRefs.length === 0) {
      throw new MemoryError(
        "VALIDATION_ERROR",
        "Automatic memory requires source provenance",
      );
    }
    if (
      input.sourceRefs.some(
        (ref) =>
          ref.sourceScopeKind === "DIRECT_CHAT" ||
          ref.sourceType === "E2EE_USER_DISCLOSURE",
      )
    ) {
      throw new MemoryError(
        "FORBIDDEN",
        "Direct Chat context cannot be automatically promoted to Memory",
      );
    }
  }
}

function assertTypeMatchesScope(
  scope: MemoryScopeKind,
  type: MemoryType,
): void {
  const allowed: Record<MemoryScopeKind, readonly MemoryType[]> = {
    PERSONAL: [
      "USER_FACT",
      "USER_PREFERENCE",
      "USER_GOAL",
      "USER_RELATIONSHIP",
      "DECISION",
      "ENTITY_RELATION",
    ],
    PROJECT: [
      "PROJECT_FACT",
      "PROJECT_DECISION",
      "PROJECT_STATE",
      "DECISION",
      "ENTITY_RELATION",
    ],
    CONVERSATION: [
      "CONVERSATION_STATE",
      "DECISION",
      "ENTITY_RELATION",
    ],
    THREAD: [
      "THREAD_STATE",
      "DECISION",
      "ENTITY_RELATION",
    ],
  };
  if (!allowed[scope].includes(type)) {
    throw new MemoryError(
      "VALIDATION_ERROR",
      "Memory type does not match its scope",
    );
  }
}

type NormalizedScope = {
  kind: MemoryScopeKind;
  scopeKey: string;
  projectId: string | null;
  conversationId: string | null;
  threadId: string | null;
};

function normalizeScope(
  actorUserId: string,
  scope: MemoryScope,
): NormalizedScope {
  switch (scope.kind) {
    case "PERSONAL":
      return {
        kind: "PERSONAL",
        scopeKey: `PERSONAL:${actorUserId}`,
        projectId: null,
        conversationId: null,
        threadId: null,
      };
    case "PROJECT":
      return {
        kind: "PROJECT",
        scopeKey: `PROJECT:${scope.projectId}`,
        projectId: scope.projectId,
        conversationId: null,
        threadId: null,
      };
    case "CONVERSATION":
      return {
        kind: "CONVERSATION",
        scopeKey: `CONVERSATION:${scope.conversationId}`,
        projectId: null,
        conversationId: scope.conversationId,
        threadId: null,
      };
    case "THREAD":
      return {
        kind: "THREAD",
        scopeKey: `THREAD:${actorUserId}:${scope.threadId}`,
        projectId: null,
        conversationId: null,
        threadId: scope.threadId,
      };
  }
}

function normalizeSlotKey(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ");
}

function hashText(value: string): string {
  return createHash("sha256")
    .update(value.normalize("NFC"))
    .digest("hex");
}

function versionMatches(
  expected: string | null | undefined,
  actual: string,
): boolean {
  return !expected || expected === actual;
}

function parseScopeKind(value: string): MemoryScopeKind {
  if (
    value === "PERSONAL" ||
    value === "PROJECT" ||
    value === "CONVERSATION" ||
    value === "THREAD"
  ) {
    return value;
  }
  throw new MemoryError(
    "VALIDATION_ERROR",
    "Stored memory scope is invalid",
  );
}

function parseMemoryType(value: string): MemoryType {
  if ((MEMORY_TYPES as readonly string[]).includes(value)) {
    return value as MemoryType;
  }
  throw new MemoryError(
    "VALIDATION_ERROR",
    "Stored memory type is invalid",
  );
}

function parseClassification(
  value: string,
): MemoryClassification {
  if (
    value === "PUBLIC" ||
    value === "INTERNAL" ||
    value === "PRIVATE" ||
    value === "RESTRICTED"
  ) {
    return value;
  }
  throw new MemoryError(
    "VALIDATION_ERROR",
    "Stored memory classification is invalid",
  );
}

function parseSensitivity(
  value: string,
): MemorySensitivity {
  if (value === "NORMAL" || value === "SENSITIVE") {
    return value;
  }
  throw new MemoryError(
    "VALIDATION_ERROR",
    "Stored memory sensitivity is invalid",
  );
}

function parseOrigin(value: string): MemoryOrigin {
  if ((MEMORY_ORIGINS as readonly string[]).includes(value)) {
    return value as MemoryOrigin;
  }
  throw new MemoryError(
    "VALIDATION_ERROR",
    "Stored memory origin is invalid",
  );
}

function parseState(
  value: string,
): MemoryView["state"] {
  if (
    value === "ACTIVE" ||
    value === "SUPERSEDED" ||
    value === "INVALIDATED"
  ) {
    return value;
  }
  throw new MemoryError(
    "VALIDATION_ERROR",
    "Stored memory state is invalid",
  );
}

function encodeCursor(
  validFromIso: string,
  id: string,
): string {
  return Buffer.from(
    JSON.stringify([validFromIso, id]),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(
  value: string,
): { validFrom: Date; id: string } {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== "string" ||
      typeof parsed[1] !== "string"
    ) {
      throw new Error("invalid");
    }
    const validFrom = new Date(parsed[0]);
    if (!Number.isFinite(validFrom.getTime())) {
      throw new Error("invalid");
    }
    return { validFrom, id: parsed[1] };
  } catch {
    throw new MemoryError(
      "VALIDATION_ERROR",
      "Invalid memory cursor",
    );
  }
}
