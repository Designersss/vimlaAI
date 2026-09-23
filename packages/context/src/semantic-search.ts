import { validateEmbedding, type EmbeddingProvider } from "@vimla/ai";
import { Prisma, type PrismaClient } from "@vimla/database";
import { containsSensitiveContextData } from "./packer.js";
import {
  admitSemanticCall,
  silentSemanticLogger,
  type SemanticLogger,
} from "./semantic-index.js";
import { PersistedSemanticSources } from "./semantic-sources.js";
import {
  hybridRelevance,
  lexicalRelevance,
  semanticChunks,
  semanticGeneration,
  semanticHash,
} from "./semantic-text.js";
import type {
  ContextCandidate,
  ContextRetrievalProviderInput,
} from "./retrieval.js";

interface Hit {
  id: string;
  kind: string;
  sourceId: string;
  fingerprint: string;
  ordinal: number;
  chunkFingerprint: string;
  similarity: number;
  revision: bigint;
}
export class SemanticSearchService {
  readonly generation: string;
  constructor(
    private readonly db: PrismaClient,
    private readonly provider: EmbeddingProvider,
    private readonly logger: SemanticLogger = silentSemanticLogger,
  ) {
    this.generation = semanticGeneration(provider.identity);
  }
  async retrieve(
    input: ContextRetrievalProviderInput,
  ): Promise<readonly ContextCandidate[]> {
    // Identity/query come from the persisted plan, never client-provided search authority.
    const plan = await this.db.executionPlan.findFirst({
      where: {
        id: input.planId,
        userId: input.actorUserId,
        status: { in: ["PLANNING", "PLANNED"] },
      },
      include: { message: true },
    });
    if (
      !plan ||
      plan.message.id !== input.sourceMessageId ||
      plan.message.content !== input.query ||
      plan.message.conversationId !== input.conversationId ||
      Buffer.byteLength(input.query) > 8192 ||
      containsSensitiveContextData(input.query)
    )
      return [];
    try {
      const active = await this.db.semanticGeneration.findFirst({
        orderBy: { sequence: "desc" },
      });
      if (active?.id !== this.generation) return [];
      if (!(await admitSemanticCall(this.db, input.actorUserId))) {
        this.logger.warn(
          { code: "RATE_LIMITED" },
          "Semantic retrieval used lexical fallback",
        );
        return [];
      }
      const vectors = await this.provider.embed({
        texts: [input.query],
        requestId: semanticHash(`${this.generation}:${plan.id}:${input.query}`),
      });
      if (vectors.length !== 1) throw new Error("Invalid query embedding");
      const vector = validateEmbedding(
        vectors[0],
        this.provider.identity.dimensions,
      );
      // Materialize current authorized scope BEFORE distance/top-k. No global ANN post-filter leaks/recall loss.
      const hits = await this.db.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '1500ms'`;
        return tx.$queryRaw<Hit[]>(Prisma.sql`
          WITH authorized AS MATERIALIZED (
            SELECT s.id,s.kind,s."sourceId",s.fingerprint,s.revision,c.ordinal,c.fingerprint AS "chunkFingerprint",c.embedding
            FROM semantic_source s JOIN semantic_chunk c ON c."sourceKey"=s.id
            WHERE s.generation=${this.generation} AND s.status='READY'
            AND (s."ownerUserId"=${input.actorUserId}
              OR s."projectId" IN (SELECT "projectId" FROM project_member WHERE "userId"=${input.actorUserId})
              OR (s.kind='ARTIFACT' AND s."sourceId" IN (SELECT "artifactId" FROM artifact_access_grant WHERE "granteeUserId"=${input.actorUserId} AND permission='READ' AND "revokedAt" IS NULL)))
            AND vector_dims(c.embedding)=${this.provider.identity.dimensions}
            AND (
              (s.kind='MESSAGE' AND EXISTS (SELECT 1 FROM message m JOIN conversation cv ON cv.id=m."conversationId"
                WHERE m.id=s."sourceId" AND cv."userId"=${input.actorUserId} AND m.status='COMPLETE' AND cv.kind IN ('CHAT','OPERATOR')
                AND m.id<>${input.sourceMessageId} AND m."createdAt"<=${plan.message.createdAt}))
              OR (s.kind='NOTE' AND EXISTS (SELECT 1 FROM workspace_object o WHERE o.id=s."sourceId"
                AND o."personalOwnerUserId"=${input.actorUserId} AND o."deletedAt" IS NULL AND o."scopeType"='PERSONAL'))
              OR (s.kind='PROJECT' AND EXISTS (SELECT 1 FROM project p WHERE p.id=s."sourceId" AND
                (p."ownerUserId"=${input.actorUserId} OR EXISTS (SELECT 1 FROM project_member pm WHERE pm."projectId"=p.id AND pm."userId"=${input.actorUserId}))))
              OR (s.kind='ARTIFACT' AND EXISTS (SELECT 1 FROM artifact a JOIN invocation i ON i.id=a."creatorInvocationId" JOIN execution_plan ep ON ep.id=i."planId"
                WHERE a.id=s."sourceId" AND a.classification<>'RESTRICTED' AND (ep."userId"=${input.actorUserId} OR
                  EXISTS (SELECT 1 FROM artifact_access_grant ag WHERE ag."artifactId"=a.id AND ag."granteeUserId"=${input.actorUserId} AND ag.permission='READ' AND ag."revokedAt" IS NULL))))
            )
          ), ranked AS (
            SELECT id,kind,"sourceId",fingerprint,revision,ordinal,"chunkFingerprint",
              1-(embedding <=> ${JSON.stringify(vector)}::vector) AS similarity,
              row_number() OVER (PARTITION BY id ORDER BY embedding <=> ${JSON.stringify(vector)}::vector,ordinal) AS "sourceRank"
            FROM authorized
          ) SELECT id,kind,"sourceId",fingerprint,revision,ordinal,"chunkFingerprint",similarity
          FROM ranked WHERE "sourceRank"=1 AND similarity>=0.55
          ORDER BY similarity DESC,id,ordinal LIMIT 48`);
      });
      const sources = new PersistedSemanticSources(this.db);
      const candidates: ContextCandidate[] = [];
      const seen = new Set<string>();
      for (const hit of hits) {
        if (seen.has(hit.id)) continue;
        const doc = await sources.load(hit, input.actorUserId);
        if (!doc || doc.fingerprint !== hit.fingerprint) continue;
        const chunk = semanticChunks(doc.text)[hit.ordinal];
        if (!chunk || semanticHash(chunk) !== hit.chunkFingerprint) continue;
        const current = await this.db.semanticSource.findFirst({
          where: {
            id: hit.id,
            revision: hit.revision,
            generation: this.generation,
            status: "READY",
            fingerprint: hit.fingerprint,
          },
          select: { id: true },
        });
        if (!current) continue;
        seen.add(hit.id);
        const directReference = input.query.includes(doc.item.sourceId);
        const currentSurface = doc.conversationId === input.conversationId;
        // Snapshot uniqueness stays source-based. Notes contribute a selected chunk, not an unbounded full document.
        const item =
          hit.kind === "NOTE"
            ? {
                ...doc.item,
                metadata: {
                  kind: "NOTE",
                  content: chunk,
                  chunkOrdinal: hit.ordinal,
                },
              }
            : doc.item;
        candidates.push({
          item,
          sourceScope: doc.scope,
          sourceKind:
            hit.kind === "MESSAGE"
              ? currentSurface
                ? "OLDER_HISTORY"
                : "CROSS_CONVERSATION"
              : hit.kind === "NOTE"
                ? "FILE_METADATA"
                : hit.kind === "PROJECT"
                  ? "PROJECT_OBJECT"
                  : "ARTIFACT",
          authority: hit.kind === "MESSAGE" ? "RAW" : "AUTHORITATIVE",
          reason: "authorized hybrid semantic retrieval",
          lexicalScore: lexicalRelevance(input.query, chunk),
          semanticScore: Math.max(0, Math.min(1, hit.similarity)),
          hybridScore: hybridRelevance(
            lexicalRelevance(input.query, chunk),
            hit.similarity,
            directReference,
          ),
          directReference,
          currentSurface,
          currentProject: false,
          occurredAt: doc.occurredAt.toISOString(),
          estimatedTokens: Buffer.byteLength(JSON.stringify(item.metadata)),
        });
        if (candidates.length >= 12) break;
      }
      return candidates;
    } catch {
      // No query/index/provider details leave this boundary. Existing lexical path remains available.
      this.logger.warn(
        { code: "SEMANTIC_UNAVAILABLE" },
        "Semantic retrieval used lexical fallback",
      );
      return [];
    }
  }
}
