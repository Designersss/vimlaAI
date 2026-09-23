import { randomUUID } from "node:crypto";
import { validateEmbedding, type EmbeddingProvider } from "@vimla/ai";
import {
  Prisma,
  type PrismaClient,
  type SemanticSource,
} from "@vimla/database";
import {
  PersistedSemanticSources,
  type SemanticSourceResolver,
} from "./semantic-sources.js";
import {
  semanticChunks,
  semanticGeneration,
  semanticHash,
} from "./semantic-text.js";

export interface SemanticLogger {
  warn(fields: { code: string }, message: string): void;
}
export const silentSemanticLogger: SemanticLogger = { warn: () => undefined };
/** PostgreSQL admission survives replicas and process restarts. Included inference only. */
class SemanticAdmissionDenied extends Error {}
export async function admitSemanticCall(
  db: PrismaClient,
  actorUserId: string,
): Promise<boolean> {
  try {
    return await db.$transaction(async (tx) => {
      for (const [key, limit] of [
        ["global", 60],
        ["actor:" + actorUserId, 10],
      ] as const) {
        const rows = await tx.$queryRaw<{ count: number }[]>(Prisma.sql`
        INSERT INTO semantic_admission (key,"windowStart",count) VALUES (${key},date_trunc('minute',CURRENT_TIMESTAMP),1)
        ON CONFLICT (key) DO UPDATE SET
          "windowStart"=date_trunc('minute',CURRENT_TIMESTAMP),
          count=CASE WHEN semantic_admission."windowStart" < date_trunc('minute',CURRENT_TIMESTAMP) THEN 1 ELSE semantic_admission.count+1 END
        WHERE semantic_admission."windowStart" < date_trunc('minute',CURRENT_TIMESTAMP) OR semantic_admission.count < ${limit}
        RETURNING count`);
        if (!rows.length) throw new SemanticAdmissionDenied();
      }
      return true;
    });
  } catch (error: unknown) {
    if (error instanceof SemanticAdmissionDenied) return false;
    throw error;
  }
}
export class SemanticIndexer {
  readonly generation: string;
  private readonly sources: SemanticSourceResolver;
  constructor(
    private readonly db: PrismaClient,
    private readonly provider: EmbeddingProvider,
    private readonly logger: SemanticLogger = silentSemanticLogger,
    sources?: SemanticSourceResolver,
  ) {
    this.generation = semanticGeneration(provider.identity);
    this.sources = sources ?? new PersistedSemanticSources(db);
  }
  async runBatch(limit = 4, sourceKey?: string): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 16)
      throw new Error("Invalid semantic batch limit");
    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO semantic_generation (id,provider,model,"modelRevision",dimensions,"chunkVersion")
      VALUES (${this.generation},${this.provider.identity.provider},${this.provider.identity.model},
        ${this.provider.identity.revision},${this.provider.identity.dimensions},'utf8-2048-v1') ON CONFLICT (id) DO NOTHING`);
    const activeGeneration = await this.db.semanticGeneration.findFirst({
      orderBy: { sequence: "desc" },
    });
    if (activeGeneration?.id !== this.generation) return 0;
    // Bounded generation rollover and crash recovery. Query-time filtering excludes old generations immediately.
    await this.db.$executeRaw(Prisma.sql`
      UPDATE semantic_source SET generation=${this.generation}, status='PENDING', attempts=0,
        "leaseToken"=NULL,"leaseUntil"=NULL,"availableAt"=CURRENT_TIMESTAMP,fingerprint=NULL,"errorCode"=NULL
      WHERE id IN (SELECT id FROM semantic_source WHERE generation<>${this.generation}
        AND ${this.generation}=(SELECT id FROM semantic_generation ORDER BY sequence DESC LIMIT 1) ORDER BY (id=${sourceKey ?? null}) DESC NULLS LAST,id LIMIT 100 FOR UPDATE SKIP LOCKED)`);
    await this.db.$executeRaw(Prisma.sql`
      DELETE FROM semantic_chunk WHERE id IN (SELECT c.id FROM semantic_chunk c JOIN semantic_source s ON c."sourceKey"=s.id WHERE s.status<>'READY' LIMIT 3200)`);
    await this.db.$executeRaw(Prisma.sql`
      UPDATE semantic_source SET status='FAILED',"leaseToken"=NULL,"leaseUntil"=NULL,"errorCode"='RETRY_EXHAUSTED'
      WHERE status='RUNNING' AND "leaseUntil"<CURRENT_TIMESTAMP AND attempts>=5`);
    await this.db.$executeRaw(Prisma.sql`
      DELETE FROM semantic_admission WHERE key IN (SELECT key FROM semantic_admission
        WHERE "windowStart"<CURRENT_TIMESTAMP-interval '24 hours' LIMIT 1000)`);
    let processed = 0;
    for (let index = 0; index < limit; index++) {
      const job = await this.claim(sourceKey);
      if (!job) break;
      await this.process(job);
      processed++;
    }
    return processed;
  }
  private async claim(sourceKey?: string): Promise<SemanticSource | null> {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(152315, 1)`;
      const active = await tx.semanticSource.count({
        where: { status: "RUNNING", leaseUntil: { gt: new Date() } },
      });
      if (active >= 2) return null;
      const rows = await tx.$queryRaw<SemanticSource[]>(Prisma.sql`
        UPDATE semantic_source SET status='RUNNING', "leaseToken"=${randomUUID()},
          "leaseUntil"=CURRENT_TIMESTAMP+interval '90 seconds', attempts=attempts+1
        WHERE id=(SELECT id FROM semantic_source WHERE generation=${this.generation} AND attempts<5
          AND (${sourceKey ?? null}::text IS NULL OR id=${sourceKey ?? null})
          AND ${this.generation}=(SELECT id FROM semantic_generation ORDER BY sequence DESC LIMIT 1)
          AND ((status='PENDING' AND "availableAt"<=CURRENT_TIMESTAMP) OR (status='RUNNING' AND "leaseUntil"<CURRENT_TIMESTAMP))
          ORDER BY "availableAt",id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`);
      return rows[0] ?? null;
    });
  }
  private owned(job: SemanticSource): Prisma.SemanticSourceWhereInput {
    return {
      id: job.id,
      revision: job.revision,
      generation: this.generation,
      status: "RUNNING",
      leaseToken: job.leaseToken,
    };
  }
  private async process(job: SemanticSource): Promise<void> {
    try {
      const doc = await this.sources.load(job, job.ownerUserId);
      const chunks = doc ? semanticChunks(doc.text) : [];
      if (!doc || !chunks.length || chunks.some((chunk) => !chunk.trim())) {
        await this.db.semanticSource.updateMany({
          where: this.owned(job),
          data: {
            status: "SKIPPED",
            leaseToken: null,
            leaseUntil: null,
            errorCode: "SOURCE_INELIGIBLE",
          },
        });
        return;
      }
      if (!(await admitSemanticCall(this.db, job.ownerUserId))) {
        await this.db.semanticSource.updateMany({
          where: this.owned(job),
          data: {
            status: "PENDING",
            attempts: { decrement: 1 },
            leaseToken: null,
            leaseUntil: null,
            availableAt: new Date(Date.now() + 60000),
          },
        });
        return;
      }
      const vectors = await this.provider.embed({
        texts: chunks,
        requestId: semanticHash(
          `${job.id}:${job.revision}:${this.generation}:${doc.fingerprint}`,
        ),
      });
      if (vectors.length !== chunks.length)
        throw new Error("Invalid embedding batch");
      const checked = vectors.map((vector) =>
        validateEmbedding(vector, this.provider.identity.dimensions),
      );
      const current = await this.sources.load(job, job.ownerUserId);
      if (!current || current.fingerprint !== doc.fingerprint) {
        await this.db.semanticSource.updateMany({
          where: this.owned(job),
          data: {
            status: "PENDING",
            leaseToken: null,
            leaseUntil: null,
            availableAt: new Date(),
          },
        });
        return;
      }
      await this.db.$transaction(async (tx) => {
        const acquired = await tx.semanticSource.updateMany({
          where: { ...this.owned(job), leaseUntil: { gt: new Date() } },
          data: {
            status: "READY",
            fingerprint: doc.fingerprint,
            leaseToken: null,
            leaseUntil: null,
            errorCode: null,
          },
        });
        if (!acquired.count) return;
        await tx.semanticChunk.deleteMany({ where: { sourceKey: job.id } });
        for (const [ordinal, text] of chunks.entries()) {
          await tx.$executeRaw(Prisma.sql`INSERT INTO semantic_chunk (id,"sourceKey",ordinal,fingerprint,embedding)
            VALUES (${randomUUID()},${job.id},${ordinal},${semanticHash(text)},${JSON.stringify(checked[ordinal])}::vector)`);
        }
      });
    } catch {
      const terminal = job.attempts >= 5;
      await this.db.semanticSource.updateMany({
        where: this.owned(job),
        data: {
          status: terminal ? "FAILED" : "PENDING",
          leaseToken: null,
          leaseUntil: null,
          availableAt: new Date(
            Date.now() + Math.min(300000, 1000 * 2 ** job.attempts),
          ),
          errorCode: "EMBEDDING_FAILED",
        },
      });
      this.logger.warn(
        { code: "EMBEDDING_FAILED" },
        "Semantic indexing failed",
      );
    }
  }
}
