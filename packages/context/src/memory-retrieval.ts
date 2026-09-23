import type { PrismaClient } from "@vimla/database";
import type {
  ContextCandidate,
  ContextRetrievalProvider,
  ContextRetrievalProviderInput,
} from "./retrieval.js";
import type { ContextSourceScope } from "./policy.js";
import {
  ensureMemoryCurrent,
  type MemoryScopeKind,
} from "./memory.js";

const MAX_SCAN = 96;
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
    const rows = await this.db.memoryItem.findMany({
      where: {
        state: "ACTIVE",
        invalidatedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        AND: [
          {
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
          },
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

    const queryTerms = tokens(input.query);
    const current: Array<{
      row: (typeof rows)[number];
      score: number;
      directReference: boolean;
    }> = [];
    for (const row of rows) {
      if (!(await ensureMemoryCurrent(this.db, row))) {
        continue;
      }
      const score = lexicalScore(
        queryTerms,
        tokens(
          [row.slotKey, row.content, row.type].join("\n"),
        ),
      );
      const directReference =
        row.slotKey.length >= 3 &&
        input.query
          .toLocaleLowerCase()
          .includes(row.slotKey.toLocaleLowerCase());
      current.push({ row, score, directReference });
    }

    const relevant = current
      .filter(({ score, directReference }) => score > 0 || directReference)
      .sort(compareMemoryCandidate);
    const selectedIds = new Set(
      relevant.slice(0, MAX_RETURNED).map(({ row }) => row.id),
    );
    const selected = relevant.slice(0, MAX_RETURNED);

    if (selected.length < MAX_RETURNED) {
      const fallback = current
        .filter(
          ({ row }) =>
            !selectedIds.has(row.id) &&
            row.userConfirmedAt !== null,
        )
        .sort((left, right) =>
          right.row.validFrom.getTime() -
            left.row.validFrom.getTime() ||
          right.row.id.localeCompare(left.row.id),
        )
        .slice(
          0,
          Math.min(
            FALLBACK_CONFIRMED,
            MAX_RETURNED - selected.length,
          ),
        );
      selected.push(...fallback);
    }

    return selected.map(
      ({ row, score, directReference }): ContextCandidate => {
        const sourceScope = memorySourceScope(
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
          currentProject: false,
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
    .filter((token) => token.length >= 3)
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

function estimateTokens(value: string): number {
  return Math.max(
    1,
    new TextEncoder().encode(value).byteLength,
  );
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
