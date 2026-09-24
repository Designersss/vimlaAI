import { createHash, randomUUID } from "node:crypto";
import { ArtifactService } from "@vimla/artifacts";
import {
  MEMORY_CLASSIFICATIONS,
  MEMORY_ORIGINS,
  MEMORY_SCOPE_KINDS,
  MEMORY_SENSITIVITIES,
  MEMORY_TYPES,
  type MemoryClassification,
  type MemoryOrigin,
  type MemoryScopeKind,
  type MemorySensitivity,
  type MemoryType,
} from "@vimla/contracts";
import { Prisma, type PrismaClient } from "@vimla/database";
import { containsSensitiveContextData } from "./packer.js";
import { containsSensitivePersonalMemoryData } from "./memory-sensitivity.js";

export {
  MEMORY_CLASSIFICATIONS,
  MEMORY_ORIGINS,
  MEMORY_SCOPE_KINDS,
  MEMORY_SENSITIVITIES,
  MEMORY_TYPES,
};
export type {
  MemoryClassification,
  MemoryOrigin,
  MemoryScopeKind,
  MemorySensitivity,
  MemoryType,
};

export interface MemoryProjectWriteAuthorizer {
  canWriteProject(input: {
    actorUserId: string;
    projectId: string;
  }): Promise<boolean>;
}

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
  explicitProjectWrite?: { projectId: string };
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
  | "STORAGE_LIMIT"
  | "SENSITIVE_CONTENT"
  | "DISABLED";

const MEMORY_HTTP_STATUS: Record<MemoryErrorCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  STORAGE_LIMIT: 409,
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

const MAX_MEMORY_SOURCE_REFS = 32;

export class MemoryService {
  constructor(
    private readonly db: PrismaClient,
    private readonly projectWriteAuthorizer?: MemoryProjectWriteAuthorizer,
    private readonly maxActivePersonalItems = 1_000,
    private readonly maxActiveProjectItems = 2_000,
  ) {}

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

  async rememberProject(input: {
    actorUserId: string;
    projectId: string;
    type: MemoryType;
    slotKey: string;
    content: string;
    expiresAt?: Date | null;
  }): Promise<MemoryView> {
    const id = randomUUID();
    return this.ingestCandidate({
      actorUserId: input.actorUserId,
      scope: {
        kind: "PROJECT",
        projectId: input.projectId,
      },
      type: input.type,
      slotKey: input.slotKey,
      content: input.content,
      origin: "USER_EXPLICIT",
      classification: "INTERNAL",
      sensitivity: "NORMAL",
      confidence: 1,
      quality: 1,
      expiresAt: input.expiresAt,
      userConfirmed: true,
      explicitProjectWrite: { projectId: input.projectId },
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
    if (
      !current ||
      !(await ensureMemoryCurrent(this.db, current))
    ) {
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
      const lineageIds = [current.id];
      let ancestorId = current.supersedesId;
      while (ancestorId) {
        const ancestor = await tx.memoryItem.findUnique({
          where: { id: ancestorId },
          select: {
            id: true,
            supersedesId: true,
            ownerUserId: true,
          },
        });
        if (
          !ancestor ||
          ancestor.ownerUserId !== actorUserId
        ) {
          break;
        }
        lineageIds.push(ancestor.id);
        ancestorId = ancestor.supersedesId;
      }

      await tx.memoryItem.updateMany({
        where: { id: { in: lineageIds } },
        data: {
          content: "",
          contentHash: hashText(""),
        },
      });
      for (const id of lineageIds) {
        await tx.memoryItem.update({
          where: { id },
          data: {
            slotKey: `deleted:${id}`,
          },
        });
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
    projectId?: string;
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

    const targetScope: MemoryScope = input.projectId
      ? { kind: "PROJECT", projectId: input.projectId }
      : { kind: "PERSONAL" };

    return this.ingestCandidate({
      actorUserId: input.actorUserId,
      scope: targetScope,
      type: input.type,
      slotKey: input.slotKey,
      content: input.content,
      origin: "E2EE_USER_DISCLOSURE",
      classification: input.projectId ? "INTERNAL" : "PRIVATE",
      sensitivity: "NORMAL",
      confidence: 1,
      quality: 1,
      validFrom: disclosedAt,
      expiresAt: input.expiresAt,
      userConfirmed: true,
      ...(input.projectId
        ? {
            explicitProjectWrite: {
              projectId: input.projectId,
            },
          }
        : {}),
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
    let scanCursor = input.cursor
      ? decodeCursor(input.cursor)
      : null;
    const visible: MemoryView[] = [];
    const batchSize = Math.max(50, Math.min(200, input.limit * 3));

    while (visible.length <= input.limit) {
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
            ...(scanCursor
              ? [
                  {
                    OR: [
                      { validFrom: { lt: scanCursor.validFrom } },
                      {
                        validFrom: scanCursor.validFrom,
                        id: { lt: scanCursor.id },
                      },
                    ],
                  },
                ]
              : []),
          ],
        },
        include: { sourceRefs: true },
        orderBy: [{ validFrom: "desc" }, { id: "desc" }],
        take: batchSize,
      });
      if (rows.length === 0) break;

      for (const row of rows) {
        if (await ensureMemoryCurrent(this.db, row)) {
          visible.push(toMemoryView(row));
          if (visible.length > input.limit) break;
        }
      }
      if (visible.length > input.limit || rows.length < batchSize) {
        break;
      }
      const lastRaw = rows.at(-1);
      if (!lastRaw) break;
      scanCursor = {
        validFrom: lastRaw.validFrom,
        id: lastRaw.id,
      };
    }

    const items = visible.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        visible.length > input.limit && last
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
    const detectedSensitive =
      containsSensitivePersonalMemoryData(
        [input.slotKey, content].join("\n"),
      );
    const requestedClassification =
      detectedSensitive
        ? strongerClassification(
            input.classification ?? "PRIVATE",
            "RESTRICTED",
          )
        : input.classification ?? "PRIVATE";
    const sensitivity =
      detectedSensitive ? "SENSITIVE" : input.sensitivity ?? "NORMAL";
    const confidence = input.confidence ?? 0.8;
    const quality = input.quality ?? 0.8;

    const created = await this.db.$transaction(async (tx) => {
      await assertScopeWritable(
        tx,
        input.actorUserId,
        scope,
        input.type,
        this.projectWriteAuthorizer,
      );
      const sourceClassification =
        await assertSourceRefsValid(
          tx,
          input.actorUserId,
          scope,
          input.sourceRefs,
          input.explicitProjectWrite?.projectId ?? null,
          input.origin,
        );
      const classification = strongerClassification(
        requestedClassification,
        sourceClassification,
      );

      await tx.$queryRaw<Array<{ lock: string }>>(Prisma.sql`
        SELECT pg_advisory_xact_lock(
          hashtext(${hashText("memory-scope\n" + scope.scopeKey)})
        )::text AS "lock"
      `);
      const active = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "memory_item"
        WHERE "scopeKey"=${scope.scopeKey}
          AND "slotKey"=${slotKey}
          AND "state"='ACTIVE'
        FOR UPDATE
      `);
      let existing = active[0]
        ? await tx.memoryItem.findUnique({
            where: { id: active[0].id },
            include: { sourceRefs: true },
          })
        : null;
      let lineageParent = existing;
      const existingExpired =
        existing?.expiresAt !== null &&
        existing?.expiresAt !== undefined &&
        existing.expiresAt <= new Date();
      if (existing && existingExpired) {
        lineageParent = await tx.memoryItem.update({
          where: { id: existing.id },
          data: {
            state: "INVALIDATED",
            invalidatedAt: new Date(),
            invalidationReason: "EXPIRED",
          },
          include: { sourceRefs: true },
        });
        existing = null;
      }

      if (
        !existing &&
        scope.kind === "PERSONAL"
      ) {
        const activeCount = await tx.memoryItem.count({
          where: {
            ownerUserId: input.actorUserId,
            scopeKind: "PERSONAL",
            state: "ACTIVE",
            invalidatedAt: null,
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } },
            ],
          },
        });
        if (activeCount >= this.maxActivePersonalItems) {
          throw new MemoryError(
            "STORAGE_LIMIT",
            "Personal Memory storage limit reached",
          );
        }
      }

      if (
        !existing &&
        scope.kind === "PROJECT"
      ) {
        const activeCount = await tx.memoryItem.count({
          where: {
            scopeKey: scope.scopeKey,
            state: "ACTIVE",
            invalidatedAt: null,
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } },
            ],
          },
        });
        if (activeCount >= this.maxActiveProjectItems) {
          throw new MemoryError(
            "STORAGE_LIMIT",
            "Project Memory storage limit reached",
          );
        }
      }

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
        !existingExpired &&
        existing.state === "ACTIVE" &&
        input.origin === "AUTO_EXTRACTION" &&
        existing.origin === "AUTO_EXTRACTION" &&
        existing.contentHash === contentHash &&
        existing.type === input.type
      ) {
        for (const ref of input.sourceRefs) {
          await tx.memorySourceRef.upsert({
            where: {
              memoryId_provenance_sourceType_sourceId: {
                memoryId: existing.id,
                provenance: ref.provenance,
                sourceType: ref.sourceType,
                sourceId: ref.sourceId,
              },
            },
            create: {
              memoryId: existing.id,
              provenance: ref.provenance,
              sourceType: ref.sourceType,
              sourceId: ref.sourceId,
              sourceVersion: ref.sourceVersion ?? null,
              sourceScopeKind: ref.sourceScopeKind,
              sourceScopeId: ref.sourceScopeId ?? null,
              disclosedAt: ref.disclosedAt ?? null,
            },
            update: {
              sourceVersion: ref.sourceVersion ?? null,
              sourceScopeKind: ref.sourceScopeKind,
              sourceScopeId: ref.sourceScopeId ?? null,
              disclosedAt: ref.disclosedAt ?? null,
            },
          });
        }
        const newestEvidence =
          await tx.memorySourceRef.findMany({
            where: {
              memoryId: existing.id,
              provenance: "AUTO_EXTRACTION",
              sourceType: "MESSAGE",
            },
            select: { id: true },
            orderBy: [
              { createdAt: "desc" },
              { id: "desc" },
            ],
            take: MAX_MEMORY_SOURCE_REFS,
          });
        const keepIds = newestEvidence.map((ref) => ref.id);
        if (keepIds.length > 0) {
          await tx.memorySourceRef.deleteMany({
            where: {
              memoryId: existing.id,
              provenance: "AUTO_EXTRACTION",
              sourceType: "MESSAGE",
              id: { notIn: keepIds },
            },
          });
        }

        const refreshed = await tx.memoryItem.update({
          where: { id: existing.id },
          data: {
            classification: strongerClassification(
              parseClassification(existing.classification),
              classification,
            ),
            expiresAt:
              input.expiresAt === undefined
                ? existing.expiresAt
                : input.expiresAt,
            quality: Math.max(existing.quality, quality),
            confidence: Math.max(existing.confidence, confidence),
          },
          include: { sourceRefs: true },
        });
        return refreshed;
      }

      if (
        existing &&
        !existingExpired &&
        existing.state === "ACTIVE" &&
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
        !existingExpired &&
        existing.state === "ACTIVE" &&
        input.origin === "AUTO_EXTRACTION" &&
        existing.validFrom > validFrom
      ) {
        return existing;
      }

      if (
        existing &&
        !existingExpired &&
        existing.state === "ACTIVE"
      ) {
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
          generation: lineageParent
            ? lineageParent.generation + 1
            : 1,
          origin: input.origin,
          state: "ACTIVE",
          validFrom,
          expiresAt,
          supersedesId: lineageParent?.id ?? null,
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

  const automaticEvidence = row.sourceRefs.filter(
    (ref) =>
      ref.provenance === "AUTO_EXTRACTION" &&
      ref.sourceType === "MESSAGE",
  );
  if (
    automaticEvidence.length > 0 &&
    automaticEvidence.length === row.sourceRefs.length
  ) {
    for (const ref of automaticEvidence) {
      if (await sourceRefCurrent(db, row, ref)) {
        return true;
      }
    }
    await invalidateIfActive(
      db,
      row.id,
      "SOURCE_STALE_OR_INACCESSIBLE",
    );
    return false;
  }

  for (const ref of row.sourceRefs) {
    if (!(await sourceRefCurrent(db, row, ref))) {
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
      return false;
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
  projectWriteAuthorizer?: MemoryProjectWriteAuthorizer,
): Promise<void> {
  assertTypeMatchesScope(scope.kind, type);
  switch (scope.kind) {
    case "PERSONAL":
      return;
    case "THREAD":
      throw new MemoryError(
        "DISABLED",
        "Thread Memory requires the PR-18 thread authority model",
      );
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
      if (
        !projectWriteAuthorizer ||
        !(await projectWriteAuthorizer.canWriteProject({
          actorUserId,
          projectId: project.id,
        }))
      ) {
        throw new MemoryError(
          "FORBIDDEN",
          "Project Memory write is not allowed",
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
  explicitProjectWriteId: string | null,
  origin: MemoryOrigin,
): Promise<MemoryClassification> {
  if (refs.length === 0) return "PUBLIC";
  if (refs.length > MAX_MEMORY_SOURCE_REFS) {
    throw new MemoryError(
      "VALIDATION_ERROR",
      "Too many memory source references",
    );
  }

  let classification: MemoryClassification = "PUBLIC";
  for (const ref of refs) {
    const resolved = await assertSourceRefValid(
      tx,
      actorUserId,
      ref,
    );
    if (
      origin === "AUTO_EXTRACTION" &&
      targetScope.kind === "PERSONAL" &&
      resolved.scopeKind === "PROJECT"
    ) {
      throw new MemoryError(
        "FORBIDDEN",
        "Project-scoped sources cannot be automatically promoted to Personal Memory",
      );
    }
    if (
      targetScope.kind === "CONVERSATION" &&
      !(
        resolved.scopeKind === "CONVERSATION" &&
        resolved.scopeId === targetScope.conversationId
      )
    ) {
      throw new MemoryError(
        "FORBIDDEN",
        "Conversation memory sources must belong to the target conversation",
      );
    }
    if (
      targetScope.kind === "PROJECT" &&
      !(
        resolved.scopeKind === "PROJECT" &&
        resolved.scopeId === targetScope.projectId
      ) &&
      explicitProjectWriteId !== targetScope.projectId
    ) {
      throw new MemoryError(
        "FORBIDDEN",
        "Project memory requires an explicit cross-scope write",
      );
    }
    classification = strongerClassification(
      classification,
      resolved.classification,
    );
  }
  return classification;
}

async function assertSourceRefValid(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  ref: MemorySourceRefInput,
): Promise<{
  classification: MemoryClassification;
  scopeKind: MemoryScopeKind | "DIRECT_CHAT";
  scopeId: string | null;
}> {
  switch (ref.sourceType) {
    case "USER_EXPLICIT":
      assertClaimedScope(
        ref,
        "PERSONAL",
        actorUserId,
        "Explicit memory",
      );
      return {
        classification: "PRIVATE",
        scopeKind: "PERSONAL",
        scopeId: actorUserId,
      };
    case "USER_CORRECTION": {
      const row = await tx.memoryItem.findFirst({
        where: {
          id: ref.sourceId,
          ownerUserId: actorUserId,
        },
        select: {
          id: true,
          classification: true,
        },
      });
      if (!row) {
        throw new MemoryError(
          "VALIDATION_ERROR",
          "Correction source is invalid",
        );
      }
      assertClaimedScope(
        ref,
        "PERSONAL",
        actorUserId,
        "Correction memory",
      );
      return {
        classification: parseClassification(
          row.classification,
        ),
        scopeKind: "PERSONAL",
        scopeId: actorUserId,
      };
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
      assertClaimedScope(
        ref,
        "CONVERSATION",
        row.conversationId,
        "Message memory",
      );
      return {
        classification: "PRIVATE",
        scopeKind: "CONVERSATION",
        scopeId: row.conversationId,
      };
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
      assertClaimedScope(
        ref,
        "PERSONAL",
        actorUserId,
        "Workspace memory",
      );
      return {
        classification: "PRIVATE",
        scopeKind: "PERSONAL",
        scopeId: actorUserId,
      };
    }
    case "PROJECT": {
      const row = await tx.project.findFirst({
        where: {
          id: ref.sourceId,
          OR: [
            { ownerUserId: actorUserId },
            {
              members: {
                some: { userId: actorUserId },
              },
            },
          ],
        },
        select: {
          id: true,
          updatedAt: true,
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
          "Project memory source is stale or inaccessible",
        );
      }
      assertClaimedScope(
        ref,
        "PROJECT",
        row.id,
        "Project memory",
      );
      return {
        classification: "INTERNAL",
        scopeKind: "PROJECT",
        scopeId: row.id,
      };
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
          classification: true,
          versions: {
            select: { id: true },
            orderBy: { version: "desc" },
            take: 1,
          },
        },
      });
      if (
        !row ||
        !ref.sourceVersion ||
        row.versions[0]?.id !== ref.sourceVersion
      ) {
        throw new MemoryError(
          "VALIDATION_ERROR",
          "Artifact memory source is stale or inaccessible",
        );
      }
      assertClaimedScope(
        ref,
        "PERSONAL",
        actorUserId,
        "Artifact memory",
      );
      return {
        classification: parseClassification(
          row.classification,
        ),
        scopeKind: "PERSONAL",
        scopeId: actorUserId,
      };
    }
    case "E2EE_USER_DISCLOSURE": {
      const row = await tx.directMessage.findFirst({
        where: {
          id: ref.sourceId,
          conversation: {
            members: {
              some: { userId: actorUserId },
            },
          },
        },
        select: {
          conversationId: true,
          createdAt: true,
        },
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
      assertClaimedScope(
        ref,
        "DIRECT_CHAT",
        row.conversationId,
        "E2EE disclosure",
      );
      return {
        classification: "PRIVATE",
        scopeKind: "DIRECT_CHAT",
        scopeId: row.conversationId,
      };
    }
  }
}

function assertClaimedScope(
  ref: MemorySourceRefInput,
  expectedKind: MemoryScopeKind | "DIRECT_CHAT",
  expectedId: string,
  label: string,
): void {
  if (
    ref.sourceScopeKind !== expectedKind ||
    ref.sourceScopeId !== expectedId
  ) {
    throw new MemoryError(
      "VALIDATION_ERROR",
      `${label} source scope is invalid`,
    );
  }
}

async function sourceRefCurrent(
  db: PrismaClient,
  memory: {
    ownerUserId: string;
    scopeKind: string;
    projectId: string | null;
  },
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
      return true;
    case "E2EE_USER_DISCLOSURE": {
      if (
        ref.sourceScopeKind !== "DIRECT_CHAT" ||
        !ref.sourceScopeId ||
        !ref.sourceVersion
      ) {
        return false;
      }
      const row = await db.directMessage.findFirst({
        where: {
          id: ref.sourceId,
          conversationId: ref.sourceScopeId,
          conversation: {
            members: {
              some: { userId: memory.ownerUserId },
            },
          },
        },
        select: { createdAt: true },
      });
      return Boolean(
        row &&
          versionMatches(
            ref.sourceVersion,
            row.createdAt.toISOString(),
          ),
      );
    }
    case "MESSAGE": {
      if (
        ref.sourceScopeKind !== "CONVERSATION" ||
        !ref.sourceScopeId
      ) {
        return false;
      }
      const row = await db.message.findFirst({
        where: {
          id: ref.sourceId,
          conversationId: ref.sourceScopeId,
          conversation: { userId: memory.ownerUserId },
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
      if (
        ref.sourceScopeKind !== "PERSONAL" ||
        ref.sourceScopeId !== memory.ownerUserId
      ) {
        return false;
      }
      const row = await db.workspaceObject.findFirst({
        where: {
          id: ref.sourceId,
          personalOwnerUserId: memory.ownerUserId,
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
      if (
        ref.sourceScopeKind !== "PROJECT" ||
        ref.sourceScopeId !== ref.sourceId
      ) {
        return false;
      }
      const projectScoped =
        memory.scopeKind === "PROJECT" &&
        memory.projectId === ref.sourceId;
      const row = projectScoped
        ? await db.project.findUnique({
            where: { id: ref.sourceId },
            select: { updatedAt: true },
          })
        : await db.project.findFirst({
            where: {
              id: ref.sourceId,
              OR: [
                { ownerUserId: memory.ownerUserId },
                {
                  members: {
                    some: {
                      userId: memory.ownerUserId,
                    },
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
      if (
        ref.sourceScopeKind !== "PERSONAL" ||
        ref.sourceScopeId !== memory.ownerUserId ||
        !ref.sourceVersion
      ) {
        return false;
      }
      const artifact = await db.artifact.findFirst({
        where: {
          id: ref.sourceId,
          OR: [
            {
              creatorInvocation: {
                plan: { userId: memory.ownerUserId },
              },
            },
            {
              accessGrants: {
                some: {
                  granteeUserId: memory.ownerUserId,
                  permission: "READ",
                  revokedAt: null,
                },
              },
            },
          ],
        },
        select: {
          versions: {
            select: { id: true },
            orderBy: { version: "desc" },
            take: 1,
          },
        },
      });
      if (
        !artifact ||
        artifact.versions[0]?.id !== ref.sourceVersion
      ) {
        return false;
      }
      try {
        return await new ArtifactService(db).canReadVersion({
          actorUserId: memory.ownerUserId,
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
  if (
    input.sourceRefs.some(
      (ref) => ref.provenance !== input.origin,
    )
  ) {
    throw new MemoryError(
      "VALIDATION_ERROR",
      "Memory source provenance must match memory origin",
    );
  }
  if (
    input.origin === "AUTO_EXTRACTION" &&
    (input.userConfirmed === true ||
      input.userCorrected === true)
  ) {
    throw new MemoryError(
      "VALIDATION_ERROR",
      "Automatic memory cannot grant itself user authority",
    );
  }
  if (
    (input.origin === "USER_EXPLICIT" ||
      input.origin === "E2EE_USER_DISCLOSURE") &&
    input.userConfirmed !== true
  ) {
    throw new MemoryError(
      "VALIDATION_ERROR",
      "Explicit memory requires user confirmation",
    );
  }
  if (
    input.origin === "USER_CORRECTION" &&
    !(
      input.userConfirmed === true &&
      input.userCorrected === true
    )
  ) {
    throw new MemoryError(
      "VALIDATION_ERROR",
      "User correction requires confirmed correction markers",
    );
  }
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
  if (
    input.origin === "AUTO_EXTRACTION" &&
    containsSensitivePersonalMemoryData(
      [input.slotKey, content].join("\n"),
    )
  ) {
    throw new MemoryError(
      "SENSITIVE_CONTENT",
      "Sensitive personal facts cannot be stored by automatic Memory extraction",
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
  return (
    typeof expected === "string" &&
    expected.length > 0 &&
    expected === actual
  );
}

function strongerClassification(
  left: MemoryClassification,
  right: MemoryClassification,
): MemoryClassification {
  const rank: Record<MemoryClassification, number> = {
    PUBLIC: 0,
    INTERNAL: 1,
    PRIVATE: 2,
    RESTRICTED: 3,
  };
  return rank[left] >= rank[right] ? left : right;
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
