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
import { MemoryError } from "./memory.js";

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
  inputTokenEstimate: number;
  outputTokenEstimate: number;
  explicitCrossScopeWrite?: boolean;
}

type CompactedRow =
  Prisma.CompactedContextStateGetPayload<Record<string, never>>;

export class CompactedStateService {
  constructor(private readonly db: PrismaClient) {}

  async refresh(
    input: RefreshCompactedStateInput,
  ): Promise<CompactedRow> {
    validateRefreshInput(input);
    const scope = normalizeScope(input.actorUserId, input.scope);
    if (
      !shouldUseCompactedState(
        input.inputTokenEstimate,
        input.budget,
      )
    ) {
      throw new MemoryError(
        "CONFLICT",
        "Compaction is not required by the effective context budget",
      );
    }

    const refs = [...input.sourceRefs].sort(
      (left, right) =>
        left.occurredAt.getTime() -
          right.occurredAt.getTime() ||
        left.sourceId.localeCompare(right.sourceId),
    );
    const first = refs[0];
    const last = refs.at(-1);
    if (!first || !last) {
      throw new MemoryError(
        "VALIDATION_ERROR",
        "Compaction requires source provenance",
      );
    }
    const sourceFingerprint = hashJson(
      refs.map((ref) => ({
        sourceType: ref.sourceType,
        sourceId: ref.sourceId,
        sourceVersion: ref.sourceVersion,
        occurredAt: ref.occurredAt.toISOString(),
        sourceScopeKind: ref.sourceScopeKind,
        sourceScopeId: ref.sourceScopeId,
      })),
    );

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
      );
      await validateCompactionSources(
        tx,
        input.actorUserId,
        scope,
        refs,
        input.explicitCrossScopeWrite === true,
      );

      const latest =
        await tx.compactedContextState.findFirst({
          where: { scopeKey: scope.scopeKey },
          orderBy: { version: "desc" },
        });
      if (
        latest &&
        latest.sourceFingerprint === sourceFingerprint &&
        latest.contentHash === hashText(input.content)
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
          classification: input.classification,
          content: input.content.trim(),
          contentHash: hashText(input.content),
          sourceRefs: refs.map((ref) => ({
            sourceType: ref.sourceType,
            sourceId: ref.sourceId,
            sourceVersion: ref.sourceVersion,
            occurredAt: ref.occurredAt.toISOString(),
            sourceScopeKind: ref.sourceScopeKind,
            sourceScopeId: ref.sourceScopeId,
          })) as Prisma.InputJsonValue,
          sourceFingerprint,
          coveredFromSourceId: first.sourceId,
          coveredToSourceId: last.sourceId,
          coveredFromAt: first.occurredAt,
          coveredToAt: last.occurredAt,
          sourceCount: refs.length,
          inputTokenEstimate: input.inputTokenEstimate,
          outputTokenEstimate: input.outputTokenEstimate,
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
  const refs = parseSourceRefs(row.sourceRefs);
  if (refs.length !== row.sourceCount) return false;

  for (const ref of refs) {
    if (ref.sourceType === "MESSAGE") {
      const message = await db.message.findFirst({
        where: {
          id: ref.sourceId,
          ...(ref.sourceScopeKind === "CONVERSATION"
            ? { conversationId: ref.sourceScopeId }
            : {}),
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
          select: {
            version: true,
            invalidatedAt: true,
          },
        });
      if (
        !source ||
        source.invalidatedAt ||
        String(source.version) !== ref.sourceVersion
      ) {
        return false;
      }
      continue;
    }
    return false;
  }
  return true;
}

async function assertCompactedScopeWritable(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  scope: NormalizedCompactedScope,
): Promise<void> {
  switch (scope.kind) {
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
    }
  }
}

async function validateCompactionSources(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  targetScope: NormalizedCompactedScope,
  refs: readonly CompactedStateSourceRef[],
  explicitCrossScopeWrite: boolean,
): Promise<void> {
  if (refs.length < 1 || refs.length > 512) {
    throw new MemoryError(
      "VALIDATION_ERROR",
      "Compaction source range is invalid",
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
        "Project compaction requires an explicit cross-scope write",
      );
    }

    if (ref.sourceType === "MESSAGE") {
      const message = await tx.message.findFirst({
        where: {
          id: ref.sourceId,
          status: "COMPLETE",
          ...(ref.sourceScopeKind === "CONVERSATION"
            ? {
                conversationId: ref.sourceScopeId,
                conversation: {
                  userId: actorUserId,
                },
              }
            : {}),
        },
        select: { updatedAt: true },
      });
      if (
        !message ||
        message.updatedAt.toISOString() !==
          ref.sourceVersion
      ) {
        throw new MemoryError(
          "VALIDATION_ERROR",
          "Compaction message source is stale or inaccessible",
        );
      }
      continue;
    }

    const source =
      await tx.compactedContextState.findFirst({
        where: {
          id: ref.sourceId,
          invalidatedAt: null,
          OR: [
            { ownerUserId: actorUserId },
            {
              project: {
                OR: [
                  { ownerUserId: actorUserId },
                  {
                    members: {
                      some: { userId: actorUserId },
                    },
                  },
                ],
              },
            },
          ],
        },
        select: {
          version: true,
          ownerUserId: true,
          scopeKind: true,
          projectId: true,
          conversationId: true,
          threadId: true,
        },
      });
    const sourceScopeId =
      source?.scopeKind === "PROJECT"
        ? source.projectId
        : source?.scopeKind === "CONVERSATION"
          ? source.conversationId
          : source?.scopeKind === "THREAD"
            ? source.threadId
            : null;
    if (
      !source ||
      String(source.version) !== ref.sourceVersion ||
      source.scopeKind !== ref.sourceScopeKind ||
      sourceScopeId !== ref.sourceScopeId
    ) {
      throw new MemoryError(
        "VALIDATION_ERROR",
        "Compacted source state is stale or inaccessible",
      );
    }
  }
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
  if (
    !Number.isInteger(input.inputTokenEstimate) ||
    input.inputTokenEstimate < 1 ||
    !Number.isInteger(input.outputTokenEstimate) ||
    input.outputTokenEstimate < 1
  ) {
    throw new MemoryError(
      "VALIDATION_ERROR",
      "Compaction token estimates are invalid",
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
