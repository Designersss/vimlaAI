import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@vimla/database";
import {
  shouldUseCompactedState,
  type ContextBudget,
} from "./budget.js";
import { containsSensitiveContextData } from "./packer.js";
import type {
  ContextCandidate,
  ContextRetrievalProvider,
  ContextRetrievalProviderInput,
} from "./retrieval.js";
import type { ContextSourceScope } from "./policy.js";
import {
  MemoryError,
  type MemoryProjectWriteAuthorizer,
} from "./memory.js";

export type CompactedScope =
  | { kind: "CONVERSATION"; conversationId: string }
  | { kind: "PROJECT"; projectId: string }
  | { kind: "THREAD"; threadId: string };

export interface CompactedStateSourceRef {
  sourceType: "MESSAGE" | "COMPACTED_STATE";
  sourceId: string;
  sourceVersion: string;
  occurredAt: Date;
  sourceScopeKind: "CONVERSATION" | "PROJECT" | "THREAD";
  sourceScopeId: string;
}

export interface RefreshCompactedStateInput {
  actorUserId: string;
  scope: CompactedScope;
  classification: "PUBLIC" | "INTERNAL" | "PRIVATE" | "RESTRICTED";
  content: string;
  sourceRefs: readonly CompactedStateSourceRef[];
  budget: ContextBudget;
  inputTokenEstimate?: number;
  outputTokenEstimate?: number;
  explicitCrossScopeWrite?: boolean;
}

type CompactedRow =
  Prisma.CompactedContextStateGetPayload<Record<string, never>>;

export class CompactedStateService {
  constructor(
    private readonly db: PrismaClient,
    private readonly projectWriteAuthorizer?: MemoryProjectWriteAuthorizer,
  ) {}

  async refresh(
    input: RefreshCompactedStateInput,
  ): Promise<CompactedRow> {
    validateRefreshInput(input);
    const scope = normalizeScope(input.actorUserId, input.scope);

    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ lock: string }>>(Prisma.sql`
        SELECT pg_advisory_xact_lock(
          hashtext(${scope.scopeKey})
        )::text AS "lock"
      `);
      await assertCompactedScopeWritable(
        tx,
        input.actorUserId,
        scope,
        this.projectWriteAuthorizer,
      );
      const resolved = await resolveCompactionSources(
        tx,
        input.actorUserId,
        scope,
        input.sourceRefs,
        input.explicitCrossScopeWrite === true,
      );
      if (
        !shouldUseCompactedState(
          resolved.inputTokenEstimate,
          input.budget,
        )
      ) {
        throw new MemoryError(
          "CONFLICT",
          "Compaction is not required by the effective context budget",
        );
      }

      const content = input.content.trim();
      const outputTokenEstimate = estimateTokens(content);
      const classification = strongerClassification(
        input.classification,
        resolved.classification,
      );
      const sourceFingerprint = hashJson(
        resolved.refs.map((ref) => ({
          sourceType: ref.sourceType,
          sourceId: ref.sourceId,
          sourceVersion: ref.sourceVersion,
          occurredAt: ref.occurredAt.toISOString(),
          sourceScopeKind: ref.sourceScopeKind,
          sourceScopeId: ref.sourceScopeId,
        })),
      );

      const latest =
        await tx.compactedContextState.findFirst({
          where: { scopeKey: scope.scopeKey },
          orderBy: { version: "desc" },
        });
      if (
        latest &&
        latest.invalidatedAt === null &&
        latest.sourceFingerprint === sourceFingerprint &&
        latest.contentHash === hashText(content)
      ) {
        return latest;
      }

      await tx.compactedContextState.updateMany({
        where: {
          scopeKey: scope.scopeKey,
          invalidatedAt: null,
        },
        data: {
          invalidatedAt: new Date(),
          invalidationReason: "SUPERSEDED",
        },
      });

      return tx.compactedContextState.create({
        data: {
          ownerUserId: input.actorUserId,
          scopeKind: scope.kind,
          scopeKey: scope.scopeKey,
          projectId: scope.projectId,
          conversationId: scope.conversationId,
          threadId: scope.threadId,
          version: (latest?.version ?? 0) + 1,
          classification,
          content,
          contentHash: hashText(content),
          sourceRefs: resolved.refs.map((ref) => ({
            sourceType: ref.sourceType,
            sourceId: ref.sourceId,
            sourceVersion: ref.sourceVersion,
            occurredAt: ref.occurredAt.toISOString(),
            sourceScopeKind: ref.sourceScopeKind,
            sourceScopeId: ref.sourceScopeId,
          })) as Prisma.InputJsonValue,
          sourceFingerprint,
          coveredFromSourceId: resolved.coveredFromSourceId,
          coveredToSourceId: resolved.coveredToSourceId,
          coveredFromAt: resolved.coveredFromAt,
          coveredToAt: resolved.coveredToAt,
          sourceCount: resolved.sourceCount,
          inputTokenEstimate: resolved.inputTokenEstimate,
          outputTokenEstimate,
          validFrom: new Date(),
        },
      });
    });
  }
}

export class CompactedStateRetrievalProvider
  implements ContextRetrievalProvider
{
  constructor(private readonly db: PrismaClient) {}

  async retrieve(
    input: ContextRetrievalProviderInput,
  ): Promise<readonly ContextCandidate[]> {
    const rows = await this.db.compactedContextState.findMany({
      where: {
        invalidatedAt: null,
        OR: [
          {
            scopeKind: "CONVERSATION",
            ownerUserId: input.actorUserId,
            conversationId: input.conversationId,
          },
          {
            scopeKind: "PROJECT",
            project: {
              OR: [
                { ownerUserId: input.actorUserId },
                {
                  members: {
                    some: { userId: input.actorUserId },
                  },
                },
              ],
            },
          },
        ],
      },
      orderBy: [
        { validFrom: "desc" },
        { version: "desc" },
      ],
      take: 16,
    });

    const candidates: ContextCandidate[] = [];
    for (const row of rows) {
      if (
        !(await canReadCompactedState(
          this.db,
          input.actorUserId,
          row.id,
        ))
      ) {
        continue;
      }
      const scope = sourceScope(
        input.actorUserId,
        row.scopeKind,
        row.projectId,
      );
      candidates.push({
        item: {
          sourceType: "COMPACTED_STATE",
          sourceId: row.id,
          sourceVersion: String(row.version),
          classification: parseClassification(
            row.classification,
          ),
          contentRef: `vimla://compacted-state/${row.id}`,
          metadata: {
            content: row.content,
            scopeKind: row.scopeKind,
            version: row.version,
            sourceCount: row.sourceCount,
            coveredFromAt:
              row.coveredFromAt.toISOString(),
            coveredToAt: row.coveredToAt.toISOString(),
          },
        },
        sourceKind: "L2_COMPACTED",
        sourceScope: scope,
        reason: "budget-triggered compacted context state",
        lexicalScore: 0,
        directReference: false,
        currentSurface:
          row.scopeKind === "CONVERSATION" &&
          row.conversationId === input.conversationId,
        currentProject: false,
        authority: "DERIVED",
        occurredAt: row.validFrom.toISOString(),
        estimatedTokens: row.outputTokenEstimate,
        rawHistoryTokens: row.inputTokenEstimate,
        stale: false,
        superseded: false,
      });
    }
    return candidates;
  }
}

export async function canReadCompactedState(
  db: PrismaClient,
  actorUserId: string,
  stateId: string,
): Promise<boolean> {
  const row = await db.compactedContextState.findUnique({
    where: { id: stateId },
  });
  if (!row || row.invalidatedAt) return false;

  if (!(await compactedScopeReadable(db, actorUserId, row))) {
    return false;
  }
  if (!(await compactedSourcesCurrent(db, row))) {
    await db.compactedContextState.updateMany({
      where: { id: row.id, invalidatedAt: null },
      data: {
        invalidatedAt: new Date(),
        invalidationReason: "SOURCE_STALE_OR_INACCESSIBLE",
      },
    });
    return false;
  }
  return true;
}

async function compactedScopeReadable(
  db: PrismaClient,
  actorUserId: string,
  row: CompactedRow,
): Promise<boolean> {
  switch (row.scopeKind) {
    case "CONVERSATION":
      return Boolean(
        row.conversationId &&
          row.ownerUserId === actorUserId &&
          (await db.conversation.findFirst({
            where: {
              id: row.conversationId,
              userId: actorUserId,
            },
            select: { id: true },
          })),
      );
    case "THREAD":
      return row.ownerUserId === actorUserId &&
        Boolean(row.threadId);
    case "PROJECT":
      return Boolean(
        row.projectId &&
          (await db.project.findFirst({
            where: {
              id: row.projectId,
              OR: [
                { ownerUserId: actorUserId },
                {
                  members: {
                    some: { userId: actorUserId },
                  },
                },
              ],
            },
            select: { id: true },
          })),
      );
    default:
      return false;
  }
}

async function compactedSourcesCurrent(
  db: PrismaClient,
  row: CompactedRow,
): Promise<boolean> {
  return compactedStateLineageCurrent(
    db,
    row,
    new Set<string>(),
  );
}

async function compactedStateLineageCurrent(
  db: PrismaClient,
  row: CompactedRow,
  visited: Set<string>,
): Promise<boolean> {
  if (visited.has(row.id)) return false;
  visited.add(row.id);
  try {
    const refs = parseSourceRefs(row.sourceRefs);
    if (refs.length === 0) return false;

    for (const ref of refs) {
      if (ref.sourceType === "MESSAGE") {
        if (
          ref.sourceScopeKind !== "CONVERSATION"
        ) {
          return false;
        }
        const message = await db.message.findFirst({
          where: {
            id: ref.sourceId,
            status: "COMPLETE",
            conversationId: ref.sourceScopeId,
            conversation: {
              userId: row.ownerUserId,
            },
          },
          select: { updatedAt: true },
        });
        if (
          !message ||
          message.updatedAt.toISOString() !==
            ref.sourceVersion
        ) {
          return false;
        }
        continue;
      }

      if (ref.sourceType === "COMPACTED_STATE") {
        const source =
          await db.compactedContextState.findUnique({
            where: { id: ref.sourceId },
          });
        if (
          !source ||
          String(source.version) !== ref.sourceVersion ||
          !compactedScopeMatchesRef(source, ref) ||
          (source.invalidatedAt !== null &&
            source.invalidationReason !== "SUPERSEDED") ||
          !(await compactedStateLineageCurrent(
            db,
            source,
            visited,
          ))
        ) {
          return false;
        }
        continue;
      }
      return false;
    }
    return true;
  } finally {
    visited.delete(row.id);
  }
}

async function assertCompactedScopeWritable(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  scope: NormalizedCompactedScope,
  projectWriteAuthorizer?: MemoryProjectWriteAuthorizer,
): Promise<void> {
  switch (scope.kind) {
    case "THREAD":
      throw new MemoryError(
        "DISABLED",
        "Thread compaction requires the PR-18 thread authority model",
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
          "Conversation compaction scope not found",
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
            {
              members: {
                some: { userId: actorUserId },
              },
            },
          ],
        },
        select: { id: true },
      });
      if (!project) {
        throw new MemoryError(
          "NOT_FOUND",
          "Project compaction scope not found",
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
          "Project compaction write is not allowed",
        );
      }
    }
  }
}

type ResolvedCompactionRef = {
  sourceType: "MESSAGE" | "COMPACTED_STATE";
  sourceId: string;
  sourceVersion: string;
  occurredAt: Date;
  sourceScopeKind: "CONVERSATION" | "PROJECT" | "THREAD";
  sourceScopeId: string;
  classification: "PUBLIC" | "INTERNAL" | "PRIVATE" | "RESTRICTED";
  inputTokenEstimate: number;
  coveredFromSourceId: string;
  coveredToSourceId: string;
  coveredFromAt: Date;
  coveredToAt: Date;
  sourceCount: number;
};

async function resolveCompactionSources(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  targetScope: NormalizedCompactedScope,
  refs: readonly CompactedStateSourceRef[],
  explicitCrossScopeWrite: boolean,
): Promise<{
  refs: ResolvedCompactionRef[];
  classification: "PUBLIC" | "INTERNAL" | "PRIVATE" | "RESTRICTED";
  inputTokenEstimate: number;
  coveredFromSourceId: string;
  coveredToSourceId: string;
  coveredFromAt: Date;
  coveredToAt: Date;
  sourceCount: number;
}> {
  if (refs.length < 1 || refs.length > 512) {
    throw new MemoryError(
      "VALIDATION_ERROR",
      "Compaction source range is invalid",
    );
  }

  const resolved: ResolvedCompactionRef[] = [];
  for (const ref of refs) {
    let item: ResolvedCompactionRef;
    if (ref.sourceType === "MESSAGE") {
      const message = await tx.message.findFirst({
        where: {
          id: ref.sourceId,
          status: "COMPLETE",
          conversation: {
            userId: actorUserId,
          },
        },
        select: {
          conversationId: true,
          content: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (
        !message ||
        message.updatedAt.toISOString() !==
          ref.sourceVersion ||
        ref.sourceScopeKind !== "CONVERSATION" ||
        ref.sourceScopeId !== message.conversationId
      ) {
        throw new MemoryError(
          "VALIDATION_ERROR",
          "Compaction message source is stale, forged, or inaccessible",
        );
      }
      item = {
        sourceType: "MESSAGE",
        sourceId: ref.sourceId,
        sourceVersion: message.updatedAt.toISOString(),
        occurredAt: message.createdAt,
        sourceScopeKind: "CONVERSATION",
        sourceScopeId: message.conversationId,
        classification: "PRIVATE",
        inputTokenEstimate: estimateTokens(message.content),
        coveredFromSourceId: ref.sourceId,
        coveredToSourceId: ref.sourceId,
        coveredFromAt: message.createdAt,
        coveredToAt: message.createdAt,
        sourceCount: 1,
      };
    } else {
      const source =
        await tx.compactedContextState.findUnique({
          where: { id: ref.sourceId },
        });
      if (
        !source ||
        source.invalidatedAt !== null ||
        String(source.version) !== ref.sourceVersion ||
        !compactedScopeMatchesRef(source, ref) ||
        !(await compactedScopeReadable(
          tx as unknown as PrismaClient,
          actorUserId,
          source,
        ))
      ) {
        throw new MemoryError(
          "VALIDATION_ERROR",
          "Compacted source state is stale, forged, or inaccessible",
        );
      }
      item = {
        sourceType: "COMPACTED_STATE",
        sourceId: source.id,
        sourceVersion: String(source.version),
        occurredAt: source.validFrom,
        sourceScopeKind:
          source.scopeKind as "CONVERSATION" | "PROJECT" | "THREAD",
        sourceScopeId: scopeIdForCompactedState(source),
        classification: parseClassification(
          source.classification,
        ),
        inputTokenEstimate: source.outputTokenEstimate,
        coveredFromSourceId: source.coveredFromSourceId,
        coveredToSourceId: source.coveredToSourceId,
        coveredFromAt: source.coveredFromAt,
        coveredToAt: source.coveredToAt,
        sourceCount: source.sourceCount,
      };
    }

    if (
      targetScope.kind === "PROJECT" &&
      !(
        item.sourceScopeKind === "PROJECT" &&
        item.sourceScopeId === targetScope.projectId
      ) &&
      !explicitCrossScopeWrite
    ) {
      throw new MemoryError(
        "FORBIDDEN",
        "Project compaction requires an explicit cross-scope write",
      );
    }
    resolved.push(item);
  }

  const ordered = [...resolved].sort(
    (left, right) =>
      left.coveredFromAt.getTime() -
        right.coveredFromAt.getTime() ||
      left.coveredFromSourceId.localeCompare(
        right.coveredFromSourceId,
      ),
  );
  const first = ordered[0];
  const last = [...ordered].sort(
    (left, right) =>
      right.coveredToAt.getTime() -
        left.coveredToAt.getTime() ||
      right.coveredToSourceId.localeCompare(
        left.coveredToSourceId,
      ),
  )[0];
  if (!first || !last) {
    throw new MemoryError(
      "VALIDATION_ERROR",
      "Compaction source range is invalid",
    );
  }

  return {
    refs: resolved,
    classification: resolved.reduce(
      (value, ref) =>
        strongerClassification(
          value,
          ref.classification,
        ),
      "PUBLIC" as
        | "PUBLIC"
        | "INTERNAL"
        | "PRIVATE"
        | "RESTRICTED",
    ),
    inputTokenEstimate: resolved.reduce(
      (total, ref) => total + ref.inputTokenEstimate,
      0,
    ),
    coveredFromSourceId: first.coveredFromSourceId,
    coveredToSourceId: last.coveredToSourceId,
    coveredFromAt: first.coveredFromAt,
    coveredToAt: last.coveredToAt,
    sourceCount: resolved.reduce(
      (total, ref) => total + ref.sourceCount,
      0,
    ),
  };
}


function validateRefreshInput(
  input: RefreshCompactedStateInput,
): void {
  const content = input.content.trim();
  if (content.length < 1 || content.length > 32_000) {
    throw new MemoryError(
      "VALIDATION_ERROR",
      "Compacted state content is invalid",
    );
  }
  if (containsSensitiveContextData({ content })) {
    throw new MemoryError(
      "SENSITIVE_CONTENT",
      "Secret-like content cannot be stored in compacted context state",
    );
  }
}

type NormalizedCompactedScope = {
  kind: "CONVERSATION" | "PROJECT" | "THREAD";
  scopeKey: string;
  projectId: string | null;
  conversationId: string | null;
  threadId: string | null;
};

function normalizeScope(
  actorUserId: string,
  scope: CompactedScope,
): NormalizedCompactedScope {
  switch (scope.kind) {
    case "CONVERSATION":
      return {
        kind: "CONVERSATION",
        scopeKey: `CONVERSATION:${scope.conversationId}`,
        projectId: null,
        conversationId: scope.conversationId,
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

function parseSourceRefs(
  value: Prisma.JsonValue,
): Array<{
  sourceType: string;
  sourceId: string;
  sourceVersion: string;
  sourceScopeKind: string;
  sourceScopeId: string;
}> {
  if (!Array.isArray(value)) return [];
  const refs: Array<{
    sourceType: string;
    sourceId: string;
    sourceVersion: string;
    sourceScopeKind: string;
    sourceScopeId: string;
  }> = [];
  for (const entry of value) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry)
    ) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.sourceType !== "string" ||
      typeof record.sourceId !== "string" ||
      typeof record.sourceVersion !== "string" ||
      typeof record.sourceScopeKind !== "string" ||
      typeof record.sourceScopeId !== "string"
    ) {
      return [];
    }
    refs.push({
      sourceType: record.sourceType,
      sourceId: record.sourceId,
      sourceVersion: record.sourceVersion,
      sourceScopeKind: record.sourceScopeKind,
      sourceScopeId: record.sourceScopeId,
    });
  }
  return refs;
}

function sourceScope(
  actorUserId: string,
  scopeKind: string,
  projectId: string | null,
): ContextSourceScope {
  if (scopeKind === "PROJECT" && projectId) {
    return { kind: "PROJECT", projectId };
  }
  return {
    kind: "PERSONAL",
    ownerUserId: actorUserId,
  };
}

function parseClassification(
  value: string,
): "PUBLIC" | "INTERNAL" | "PRIVATE" | "RESTRICTED" {
  return value === "PUBLIC" ||
    value === "INTERNAL" ||
    value === "PRIVATE" ||
    value === "RESTRICTED"
    ? value
    : "RESTRICTED";
}

function scopeIdForCompactedState(
  row: {
    scopeKind: string;
    projectId: string | null;
    conversationId: string | null;
    threadId: string | null;
  },
): string {
  const value =
    row.scopeKind === "PROJECT"
      ? row.projectId
      : row.scopeKind === "CONVERSATION"
        ? row.conversationId
        : row.scopeKind === "THREAD"
          ? row.threadId
          : null;
  if (!value) {
    throw new MemoryError(
      "VALIDATION_ERROR",
      "Compacted source scope is invalid",
    );
  }
  return value;
}

function compactedScopeMatchesRef(
  row: {
    scopeKind: string;
    projectId: string | null;
    conversationId: string | null;
    threadId: string | null;
  },
  ref: {
    sourceScopeKind: string;
    sourceScopeId: string;
  },
): boolean {
  if (row.scopeKind !== ref.sourceScopeKind) return false;
  try {
    return scopeIdForCompactedState(row) === ref.sourceScopeId;
  } catch {
    return false;
  }
}

function strongerClassification(
  left: "PUBLIC" | "INTERNAL" | "PRIVATE" | "RESTRICTED",
  right: "PUBLIC" | "INTERNAL" | "PRIVATE" | "RESTRICTED",
): "PUBLIC" | "INTERNAL" | "PRIVATE" | "RESTRICTED" {
  const rank = {
    PUBLIC: 0,
    INTERNAL: 1,
    PRIVATE: 2,
    RESTRICTED: 3,
  } as const;
  return rank[left] >= rank[right] ? left : right;
}

function estimateTokens(value: string): number {
  return Math.max(
    1,
    new TextEncoder().encode(value).byteLength,
  );
}

function hashText(value: string): string {
  return createHash("sha256")
    .update(value.normalize("NFC").trim())
    .digest("hex");
}

function hashJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}
