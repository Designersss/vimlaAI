import type { Prisma, PrismaClient } from "@vimla/database";
import type {
  ContextCandidate,
  ContextRetrievalProvider,
  ContextRetrievalProviderInput,
} from "./retrieval.js";
import type { ContextSourceScope } from "./policy.js";
import {
  estimateConservativeTokens as estimateTokens,
} from "./token-estimate.js";
import {
  ensureMemoryCurrent,
  type MemoryScopeKind,
} from "./memory.js";

const MAX_SCAN = 1_000;
const MAX_RETURNED = 24;
const FALLBACK_CONFIRMED = 6;

export class MemoryRetrievalProvider
  implements ContextRetrievalProvider
{
  constructor(private readonly db: PrismaClient) {}

  async retrieve(
    input: ContextRetrievalProviderInput,
  ): Promise<readonly ContextCandidate[]> {
    const now = new Date();
    const snapshotCutoff = new Date(
      input.sourceMessageCreatedAt,
    );
    if (!Number.isFinite(snapshotCutoff.getTime())) {
      return [];
    }
    const queryTerms = tokens(input.query);
    const scopeClause: Prisma.MemoryItemWhereInput = {
      OR: [
        {
          scopeKind: "PERSONAL",
          ownerUserId: input.actorUserId,
        },
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
    };
    const activeClauses: Prisma.MemoryItemWhereInput[] = [
      {
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      { validFrom: { lt: snapshotCutoff } },
      scopeClause,
    ];
    const lexicalTerms = queryTerms.slice(0, 16);
    const priorityScope: Prisma.MemoryItemWhereInput = {
      OR: [
        {
          scopeKind: "CONVERSATION",
          ownerUserId: input.actorUserId,
          conversationId: input.conversationId,
        },
        ...(input.currentProjectId
          ? [
              {
                scopeKind: "PROJECT" as const,
                projectId: input.currentProjectId,
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
            ]
          : []),
      ],
    };
    const lexicalFilter: Prisma.MemoryItemWhereInput =
      lexicalTerms.length === 0
        ? { id: "__no_lexical_terms__" }
        : {
            OR: lexicalTerms.flatMap((term) => [
              {
                slotKey: {
                  contains: term,
                  mode: "insensitive" as const,
                },
              },
              {
                content: {
                  contains: term,
                  mode: "insensitive" as const,
                },
              },
              {
                type: {
                  contains: term,
                  mode: "insensitive" as const,
                },
              },
            ]),
          };
    const priorityRows =
      lexicalTerms.length === 0
        ? []
        : await this.db.memoryItem.findMany({
            where: {
              state: "ACTIVE",
              invalidatedAt: null,
              AND: [
                {
                  OR: [
                    { expiresAt: null },
                    { expiresAt: { gt: now } },
                  ],
                },
                { validFrom: { lt: snapshotCutoff } },
                priorityScope,
                lexicalFilter,
              ],
            },
            include: { sourceRefs: true },
            orderBy: [
              { userCorrectedAt: "desc" },
              { userConfirmedAt: "desc" },
              { validFrom: "desc" },
              { id: "desc" },
            ],
            take: MAX_SCAN,
          });
    const relevantRows =
      lexicalTerms.length === 0
        ? []
        : await this.db.memoryItem.findMany({
            where: {
              state: "ACTIVE",
              invalidatedAt: null,
              AND: [
                ...activeClauses,
                lexicalFilter,
              ],
            },
            include: { sourceRefs: true },
            orderBy: [
              { userCorrectedAt: "desc" },
              { userConfirmedAt: "desc" },
              { validFrom: "desc" },
              { id: "desc" },
            ],
            take: MAX_SCAN,
          });
    const confirmedRows =
      await this.db.memoryItem.findMany({
        where: {
          state: "ACTIVE",
          invalidatedAt: null,
          userConfirmedAt: { not: null },
          AND: activeClauses,
        },
        include: { sourceRefs: true },
        orderBy: [
          { validFrom: "desc" },
          { id: "desc" },
        ],
        take: FALLBACK_CONFIRMED * 4,
      });
    const byId = new Map(
      [...priorityRows, ...relevantRows, ...confirmedRows].map((row) => [
        row.id,
        row,
      ]),
    );
    const rows = [...byId.values()];

    const ranked = rows
      .map((row) => {
        const score = lexicalScore(
          queryTerms,
          tokens([row.slotKey, row.content, row.type].join("\n")),
        );
        const directReference =
          row.slotKey.length >= 3 &&
          input.query
            .toLocaleLowerCase()
            .includes(row.slotKey.toLocaleLowerCase());
        return { row, score, directReference };
      })
      .sort(compareMemoryCandidate);

    const relevant = ranked.filter(
      ({ score, directReference }) =>
        score > 0 || directReference,
    );
    const fallback = ranked
      .filter(
        ({ row, score, directReference }) =>
          score <= 0 &&
          !directReference &&
          row.userConfirmedAt !== null,
      )
      .sort((left, right) =>
        right.row.validFrom.getTime() -
          left.row.validFrom.getTime() ||
        right.row.id.localeCompare(left.row.id),
      )
      .slice(0, FALLBACK_CONFIRMED);

    const ordered = [...relevant, ...fallback];
    const selected: typeof ordered = [];
    const seen = new Set<string>();
    for (const candidate of ordered) {
      if (selected.length >= MAX_RETURNED) break;
      if (seen.has(candidate.row.id)) continue;
      seen.add(candidate.row.id);
      if (!(await ensureMemoryCurrent(this.db, candidate.row))) {
        continue;
      }
      selected.push(candidate);
    }

    return selected.map(
      ({ row, score, directReference }): ContextCandidate => {
        const sourceScope: ContextSourceScope =
          input.currentProjectId &&
          row.scopeKind === "CONVERSATION" &&
          row.conversationId === input.conversationId
            ? {
                kind: "PROJECT",
                projectId: input.currentProjectId,
              }
            : memorySourceScope(
                input.actorUserId,
                row.scopeKind as MemoryScopeKind,
                row.projectId,
              );
        return {
          item: {
            sourceType: "MEMORY",
            sourceId: row.id,
            sourceVersion: String(row.generation),
            classification: parseClassification(
              row.classification,
            ),
            contentRef: `vimla://memory/${row.id}`,
            metadata: {
              content: row.content,
              memoryType: row.type,
              slotKey: row.slotKey,
              scopeKind: row.scopeKind,
              origin: row.origin,
              confidence: row.confidence,
              quality: row.quality,
              validFrom: row.validFrom.toISOString(),
              expiresAt: row.expiresAt?.toISOString() ?? null,
              userConfirmed: row.userConfirmedAt !== null,
              userCorrected: row.userCorrectedAt !== null,
            },
          },
          sourceKind:
            sourceScope.kind === "PROJECT"
              ? "PROJECT_MEMORY"
              : "PERSONAL_MEMORY",
          sourceScope,
          reason:
            score > 0 || directReference
              ? "relevant durable memory"
              : "recent user-confirmed memory fallback",
          lexicalScore: score,
          directReference,
          currentSurface:
            row.scopeKind === "CONVERSATION" &&
            row.conversationId === input.conversationId,
          currentProject:
            sourceScope.kind === "PROJECT" &&
            sourceScope.projectId === input.currentProjectId,
          authority: "DERIVED",
          occurredAt: row.validFrom.toISOString(),
          estimatedTokens: estimateTokens(row.content),
          stale: false,
          superseded: false,
        };
      },
    );
  }
}

function memorySourceScope(
  actorUserId: string,
  scopeKind: MemoryScopeKind,
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

function compareMemoryCandidate(
  left: {
    row: {
      id: string;
      quality: number;
      confidence: number;
      validFrom: Date;
      userCorrectedAt: Date | null;
      userConfirmedAt: Date | null;
    };
    score: number;
    directReference: boolean;
  },
  right: {
    row: {
      id: string;
      quality: number;
      confidence: number;
      validFrom: Date;
      userCorrectedAt: Date | null;
      userConfirmedAt: Date | null;
    };
    score: number;
    directReference: boolean;
  },
): number {
  return (
    Number(right.directReference) -
      Number(left.directReference) ||
    Number(right.row.userCorrectedAt !== null) -
      Number(left.row.userCorrectedAt !== null) ||
    Number(right.row.userConfirmedAt !== null) -
      Number(left.row.userConfirmedAt !== null) ||
    right.score - left.score ||
    right.row.quality - left.row.quality ||
    right.row.confidence - left.row.confidence ||
    right.row.validFrom.getTime() -
      left.row.validFrom.getTime() ||
    right.row.id.localeCompare(left.row.id)
  );
}

function tokens(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 256);
}

function lexicalScore(
  query: readonly string[],
  candidate: readonly string[],
): number {
  if (query.length === 0 || candidate.length === 0) {
    return 0;
  }
  const set = new Set(candidate);
  let matched = 0;
  for (const token of new Set(query)) {
    if (set.has(token)) matched += 1;
  }
  return Math.min(1, matched / Math.max(1, new Set(query).size));
}

function parseClassification(
  value: string,
): "PUBLIC" | "INTERNAL" | "PRIVATE" | "RESTRICTED" {
  if (
    value === "PUBLIC" ||
    value === "INTERNAL" ||
    value === "PRIVATE" ||
    value === "RESTRICTED"
  ) {
    return value;
  }
  return "RESTRICTED";
}
