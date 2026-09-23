import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { EmbeddingProvider } from "@vimla/ai";
import { createPrismaClient, Prisma, type PrismaClient } from "@vimla/database";
import { ArtifactService } from "@vimla/artifacts";
import { SemanticIndexer, admitSemanticCall } from "./semantic-index.js";
import { SemanticSearchService } from "./semantic-search.js";
import { PersistedSemanticSources } from "./semantic-sources.js";
import { ContextRetrievalService } from "./retrieval.js";
import { ContextSnapshotService } from "./service.js";
import { ContextBundleService } from "./bundle-service.js";
import { renderContextBundleItems } from "./render.js";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
let db: PrismaClient;
let provider: EmbeddingProvider;
let indexer: SemanticIndexer;
let search: SemanticSearchService;
let calls: string[][];

async function user() {
  const id = randomUUID();
  await db.user.create({
    data: {
      id,
      name: "Semantic test",
      email: id + "@example.test",
      emailVerified: true,
    },
  });
  return id;
}
async function message(owner: string, content: string) {
  const conversation = await db.conversation.create({
    data: { userId: owner },
  });
  return db.message.create({
    data: {
      conversationId: conversation.id,
      role: "USER",
      status: "COMPLETE",
      content,
    },
  });
}
async function plan(owner: string) {
  const msg = await message(owner, "Which color should we pick for shipping?");
  const row = await db.executionPlan.create({
    data: {
      userId: owner,
      conversationId: msg.conversationId,
      messageId: msg.id,
      schemaVersion: 1,
      planHash: randomUUID(),
      goal: "Choose",
      status: "PLANNED",
      maxParallelism: 1,
      invocations: {
        create: {
          sequence: 0,
          purpose: "Choose",
          targetKind: "VIMLA",
          outputDeclarations: [{ name: "result", artifactType: "TEXT" }],
          acceptanceCriteria: [],
          riskClass: "READ_ONLY",
          approvalPolicy: "AUTO",
          failurePolicy: "FAIL_PLAN",
          joinPolicy: "ALL_REQUIRED",
        },
      },
    },
    include: { invocations: true },
  });
  return {
    row,
    input: {
      actorUserId: owner,
      planId: row.id,
      query: msg.content,
      conversationId: msg.conversationId,
      sourceMessageId: msg.id,
      sourceMessageCreatedAt: msg.createdAt.toISOString(),
    },
  };
}
async function index(kind: string, sourceId: string) {
  await indexer.runBatch(1, `${kind}:${sourceId}`);
}
const countChunks = (sourceKey: string) =>
  db.semanticChunk.count({ where: { sourceKey } });

describe("semantic retrieval on real PostgreSQL/pgvector", () => {
  beforeAll(() => {
    db = createPrismaClient(url);
  });
  beforeEach(async () => {
    calls = [];
    provider = {
      identity: {
        provider: "internal-test",
        model: "test",
        revision: randomUUID(),
        dimensions: 3,
      },
      embed: vi.fn(async ({ texts }) => {
        calls.push([...texts]);
        return texts.map(() => [1, 0, 0]);
      }),
    };
    indexer = new SemanticIndexer(db, provider);
    search = new SemanticSearchService(db, provider);
    await db.semanticAdmission.deleteMany();
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("finds semantically similar text without lexical overlap and preserves source-based snapshot/bundle contracts", async () => {
    const owner = await user();
    const old = await message(owner, "The launch hue is violet.");
    await index("MESSAGE", old.id);
    const p = await plan(owner);
    const retrieval = new ContextRetrievalService(
      db,
      [],
      { crossConversationScanLimit: 0 },
      search,
    );
    const snapshots = new ContextSnapshotService(db, undefined, retrieval);
    const snapshot = await snapshots.createForExecutionPlan({
      actorUserId: owner,
      planId: p.row.id,
    });
    expect(
      snapshot.items.find((item) => item.sourceId === old.id)?.metadata,
    ).toMatchObject({
      content: old.content,
      retrieval: { semanticScore: 1, hybridScore: 0.7 },
    });
    const bundle = await new ContextBundleService(
      db,
      snapshots,
    ).resolveForInvocation({
      actorUserId: owner,
      invocationId: required(p.row.invocations[0]).id,
    });
    const rendered = renderContextBundleItems(bundle.items);
    expect(rendered).toContain("violet");
    expect(rendered).not.toContain("semanticScore");
    expect(rendered).not.toContain(indexer.generation);
    await db.message.update({
      where: { id: old.id },
      data: { content: "The launch hue is green." },
    });
    expect(
      (await snapshots.getByPlan(owner, p.row.id)).items.find(
        (item) => item.sourceId === old.id,
      )?.metadata,
    ).toMatchObject({ content: old.content });
    expect(await search.retrieve(p.input)).toEqual([]);
  });

  it("excludes another user's perfect vector matches before top-k", async () => {
    const owner = await user(),
      stranger = await user();
    const own = await message(owner, "violet evidence");
    const foreign = await message(stranger, "foreign private evidence");
    await index("MESSAGE", own.id);
    await index("MESSAGE", foreign.id);
    const p = await plan(owner);
    expect(
      (await search.retrieve(p.input)).map((hit) => hit.item.sourceId),
    ).toEqual([own.id]);
    expect(
      await search.retrieve({ ...p.input, actorUserId: stranger }),
    ).toEqual([]);
    expect(
      await search.retrieve({ ...p.input, query: "forged query" }),
    ).toEqual([]);
  });

  it("rechecks current project membership and rejects revoked access with the vector still present", async () => {
    const owner = await user(),
      member = await user();
    const project = await db.project.create({
      data: {
        ownerUserId: owner,
        name: "violet launch",
        members: { create: { userId: member, role: "MEMBER" } },
      },
    });
    await index("PROJECT", project.id);
    const p = await plan(member);
    expect(
      (await search.retrieve(p.input)).map((hit) => hit.item.sourceId),
    ).toContain(project.id);
    await db.projectMember.deleteMany({
      where: { projectId: project.id, userId: member },
    });
    expect(await countChunks("PROJECT:" + project.id)).toBe(1);
    expect(await search.retrieve(p.input)).toEqual([]);
  });

  it("invalidates note chunks transactionally on child update and soft deletion", async () => {
    const owner = await user();
    const note = await db.workspaceObject.create({
      data: {
        kind: "NOTE",
        personalOwnerUserId: owner,
        createdByUserId: owner,
        note: {
          create: { title: "Palette", contentMarkdown: "violet ".repeat(1000) },
        },
      },
    });
    await index("NOTE", note.id);
    expect(await countChunks("NOTE:" + note.id)).toBeGreaterThan(1);
    const p = await plan(owner);
    const hits = await search.retrieve(p.input);
    expect(hits).toHaveLength(1);
    expect(
      Buffer.byteLength(JSON.stringify(required(hits[0]).item.metadata)),
    ).toBeLessThan(2200);
    await db.workspaceNote.update({
      where: { objectId: note.id },
      data: { contentMarkdown: "green" },
    });
    expect(await countChunks("NOTE:" + note.id)).toBe(0);
    await index("NOTE", note.id);
    await db.workspaceObject.update({
      where: { id: note.id },
      data: { deletedAt: new Date() },
    });
    expect(
      await db.semanticSource.findUnique({ where: { id: "NOTE:" + note.id } }),
    ).toBeNull();
    expect(await search.retrieve(p.input)).toEqual([]);
  });

  it("does not persist vectors from a stale worker after source mutation or deletion", async () => {
    for (const remove of [false, true]) {
      const owner = await user();
      const msg = await message(owner, "original evidence");
      const changed: EmbeddingProvider = {
        ...provider,
        embed: async ({ texts }) => {
          if (remove) await db.message.delete({ where: { id: msg.id } });
          else
            await db.message.update({
              where: { id: msg.id },
              data: { content: "new evidence" },
            });
          return texts.map(() => [1, 0, 0]);
        },
      };
      await new SemanticIndexer(db, changed).runBatch(1, "MESSAGE:" + msg.id);
      expect(await countChunks("MESSAGE:" + msg.id)).toBe(0);
    }
  });

  it("claims a job once across concurrent workers and makes completed redelivery a no-op", async () => {
    const owner = await user();
    const msg = await message(owner, "parallel evidence");
    await Promise.all([index("MESSAGE", msg.id), index("MESSAGE", msg.id)]);
    expect(calls).toHaveLength(1);
    await index("MESSAGE", msg.id);
    expect(calls).toHaveLength(1);
    expect(await countChunks("MESSAGE:" + msg.id)).toBe(1);
  });

  it("re-embeds a new generation and prevents an older worker from reverting it", async () => {
    const owner = await user();
    const msg = await message(owner, "model upgrade evidence");
    await index("MESSAGE", msg.id);
    const newer = {
      ...provider,
      identity: { ...provider.identity, revision: randomUUID() },
    };
    const next = new SemanticIndexer(db, newer);
    await next.runBatch(1, "MESSAGE:" + msg.id);
    expect(await indexer.runBatch(1, "MESSAGE:" + msg.id)).toBe(0);
    expect(
      (
        await db.semanticSource.findUnique({
          where: { id: "MESSAGE:" + msg.id },
        })
      )?.generation,
    ).toBe(next.generation);
    expect(calls).toHaveLength(2);
    const p = await plan(owner);
    expect(await search.retrieve(p.input)).toEqual([]);
    expect(
      await new SemanticSearchService(db, newer).retrieve(p.input),
    ).toHaveLength(1);
  });

  it("recovers expired leases but fences old tokens and exhausts retries", async () => {
    const owner = await user();
    const msg = await message(owner, "crash recovery evidence");
    await index("MESSAGE", msg.id);
    await db.semanticSource.update({
      where: { id: "MESSAGE:" + msg.id },
      data: {
        status: "RUNNING",
        leaseToken: "dead-worker",
        leaseUntil: new Date(0),
        attempts: 1,
      },
    });
    await index("MESSAGE", msg.id);
    expect(calls).toHaveLength(2);
    expect(
      (
        await db.semanticSource.findUnique({
          where: { id: "MESSAGE:" + msg.id },
        })
      )?.status,
    ).toBe("READY");
    await db.semanticSource.update({
      where: { id: "MESSAGE:" + msg.id },
      data: {
        status: "RUNNING",
        leaseToken: "dead-worker",
        leaseUntil: new Date(0),
        attempts: 5,
      },
    });
    await index("MESSAGE", msg.id);
    expect(
      (
        await db.semanticSource.findUnique({
          where: { id: "MESSAGE:" + msg.id },
        })
      )?.status,
    ).toBe("FAILED");
  });

  it("skips credentials before inference and refuses unknown/E2EE source kinds", async () => {
    const owner = await user();
    const msg = await message(owner, "api_key=extremely-sensitive-credential");
    await index("MESSAGE", msg.id);
    expect(calls).toHaveLength(0);
    expect(
      (
        await db.semanticSource.findUnique({
          where: { id: "MESSAGE:" + msg.id },
        })
      )?.status,
    ).toBe("SKIPPED");
    expect(
      await new PersistedSemanticSources(db).load(
        { kind: "DIRECT_CHAT", sourceId: msg.id },
        owner,
      ),
    ).toBeNull();
    await expect(
      db.$executeRaw(
        Prisma.sql`INSERT INTO semantic_source (id,kind,"sourceId","ownerUserId") VALUES (${randomUUID()},'DIRECT_CHAT',${msg.id},${owner})`,
      ),
    ).rejects.toThrow();
  });

  it("isolates malformed provider output, preserves lexical fallback and records bounded errors", async () => {
    const owner = await user();
    const msg = await message(owner, "violet evidence");
    const broken = { ...provider, embed: async () => [[NaN, 0, 0]] };
    await new SemanticIndexer(db, broken).runBatch(1, "MESSAGE:" + msg.id);
    expect(await countChunks("MESSAGE:" + msg.id)).toBe(0);
    expect(
      (
        await db.semanticSource.findUnique({
          where: { id: "MESSAGE:" + msg.id },
        })
      )?.errorCode,
    ).toBe("EMBEDDING_FAILED");
    const warn = vi.fn();
    const p = await plan(owner);
    expect(
      await new SemanticSearchService(db, broken, { warn }).retrieve(p.input),
    ).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      { code: "SEMANTIC_UNAVAILABLE" },
      expect.any(String),
    );
  });

  it("fences a worker whose lease was replaced during inference", async () => {
    const owner = await user();
    const msg = await message(owner, "leased evidence");
    const stale = {
      ...provider,
      embed: async ({ texts }: { texts: readonly string[] }) => {
        await db.semanticSource.update({
          where: { id: "MESSAGE:" + msg.id },
          data: { leaseToken: "replacement-worker" },
        });
        return texts.map(() => [1, 0, 0]);
      },
    };
    await new SemanticIndexer(db, stale).runBatch(1, "MESSAGE:" + msg.id);
    expect(await countChunks("MESSAGE:" + msg.id)).toBe(0);
    expect(
      (
        await db.semanticSource.findUnique({
          where: { id: "MESSAGE:" + msg.id },
        })
      )?.leaseToken,
    ).toBe("replacement-worker");
    await db.semanticSource.update({
      where: { id: "MESSAGE:" + msg.id },
      data: { leaseUntil: new Date(0) },
    });
  });

  it("uses database time for concurrency admission when a worker clock runs ahead", async () => {
    const owner = await user();
    const first = await message(owner, "first leased source");
    const second = await message(owner, "second leased source");
    const pending = await message(owner, "pending source");
    await index("MESSAGE", first.id);
    await index("MESSAGE", second.id);
    const keys = ["MESSAGE:" + first.id, "MESSAGE:" + second.id];
    await db.$executeRaw(Prisma.sql`UPDATE semantic_source SET status='RUNNING',
      "leaseToken"='active-worker',"leaseUntil"=CURRENT_TIMESTAMP+interval '60 seconds'
      WHERE id IN (${Prisma.join(keys)})`);
    calls.length = 0;
    const now = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now + 120000);
    try {
      expect(await indexer.runBatch(1, "MESSAGE:" + pending.id)).toBe(0);
      expect(calls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
      await db.semanticSource.updateMany({
        where: { id: { in: keys } },
        data: { leaseUntil: new Date(0) },
      });
    }
  });

  it("does not commit an expired lease when a worker clock runs behind", async () => {
    const owner = await user();
    const msg = await message(owner, "expired inference result");
    const key = "MESSAGE:" + msg.id;
    const delayed: EmbeddingProvider = {
      ...provider,
      embed: async ({ texts }) => {
        await db.$executeRaw`UPDATE semantic_source SET "leaseUntil"=CURRENT_TIMESTAMP-interval '1 second' WHERE id=${key}`;
        return texts.map(() => [1, 0, 0]);
      },
    };
    const now = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now - 120000);
    try {
      await new SemanticIndexer(db, delayed).runBatch(1, key);
      expect(await countChunks(key)).toBe(0);
      expect(
        (await db.semanticSource.findUnique({ where: { id: key } }))?.status,
      ).toBe("RUNNING");
    } finally {
      vi.useRealTimers();
    }
    await index("MESSAGE", msg.id);
    expect(await countChunks(key)).toBe(1);
  });

  it("keeps semantically rediscovered recent messages in the L1 raw tail", async () => {
    const owner = await user();
    const p = await plan(owner);
    const recent = await db.message.create({
      data: {
        conversationId: p.input.conversationId,
        role: "ASSISTANT",
        status: "COMPLETE",
        content: "violet",
        createdAt: new Date(0),
      },
    });
    await index("MESSAGE", recent.id);
    const candidates = await new ContextRetrievalService(
      db,
      [],
      {},
      search,
    ).retrieveForExecutionPlan({ actorUserId: owner, planId: p.row.id });
    expect(
      candidates.candidates.find(
        (candidate) => candidate.item.sourceId === recent.id,
      )?.sourceKind,
    ).toBe("L1_RAW");
  });

  it("preserves current audience checks for semantically retrieved project context", async () => {
    const owner = await user(),
      member = await user();
    const project = await db.project.create({
      data: {
        ownerUserId: owner,
        name: "violet evidence",
        members: { create: { userId: member, role: "MEMBER" } },
      },
    });
    await index("PROJECT", project.id);
    const p = await plan(owner);
    const snapshots = new ContextSnapshotService(db);
    const candidates = await new ContextRetrievalService(
      db,
      [],
      {},
      search,
    ).retrieveForExecutionPlan({ actorUserId: owner, planId: p.row.id });
    await snapshots.create({
      actorUserId: owner,
      planId: p.row.id,
      items: candidates.candidates.map((candidate) =>
        candidate.item.sourceType === "AUDIENCE"
          ? {
              ...candidate.item,
              sourceId: project.id,
              metadata: {
                kind: "PROJECT",
                projectId: project.id,
                participantUserIds: [owner, member],
              },
            }
          : candidate.item,
      ),
    });
    await db.projectMember.deleteMany({
      where: { projectId: project.id, userId: member },
    });
    await expect(
      new ContextBundleService(db, snapshots).resolveForInvocation({
        actorUserId: owner,
        invocationId: required(p.row.invocations[0]).id,
      }),
    ).rejects.toThrow();
  });

  it("enforces scope, registry-key and lease completeness in PostgreSQL", async () => {
    const owner = await user();
    const msg = await message(owner, "constraint evidence");
    await expect(
      db.$executeRaw(Prisma.sql`INSERT INTO semantic_source (id,kind,"sourceId","ownerUserId")
      VALUES ('PROJECT:invalid','PROJECT','invalid',${owner})`),
    ).rejects.toThrow();
    await expect(
      db.semanticSource.update({
        where: { id: "MESSAGE:" + msg.id },
        data: { leaseToken: "orphaned-token" },
      }),
    ).rejects.toThrow();
    await expect(
      db.semanticSource.update({
        where: { id: "MESSAGE:" + msg.id },
        data: { id: "mismatched-key" },
      }),
    ).rejects.toThrow();
  });

  it("does not let many chunks from noisy notes crowd out other sources before packing", async () => {
    const owner = await user();
    const differentiated: EmbeddingProvider = {
      ...provider,
      embed: async ({ texts }) =>
        texts.map((text) =>
          text === "lower score evidence" ? [0.8, 0.6, 0] : [1, 0, 0],
        ),
    };
    const scopedIndexer = new SemanticIndexer(db, differentiated);
    for (let i = 0; i < 2; i++) {
      const note = await db.workspaceObject.create({
        data: {
          kind: "NOTE",
          personalOwnerUserId: owner,
          createdByUserId: owner,
          note: {
            create: { title: "Large", contentMarkdown: "violet ".repeat(9000) },
          },
        },
      });
      await scopedIndexer.runBatch(1, "NOTE:" + note.id);
      expect(await countChunks("NOTE:" + note.id)).toBeGreaterThan(24);
    }
    const msg = await message(owner, "lower score evidence");
    await scopedIndexer.runBatch(1, "MESSAGE:" + msg.id);
    const p = await plan(owner);
    expect(
      (
        await new SemanticSearchService(db, differentiated).retrieve(p.input)
      ).map((hit) => hit.item.sourceId),
    ).toContain(msg.id);
  });

  it("enforces cross-replica query admission", async () => {
    const owner = await user();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => admitSemanticCall(db, owner)),
    );
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(
      (await db.semanticAdmission.findUnique({ where: { key: "global" } }))
        ?.count,
    ).toBe(10);
  });

  it("indexes immutable artifact content, rechecks grants and invalidates on a new version", async () => {
    const owner = await user(),
      reader = await user();
    const p = await plan(owner);
    const artifacts = new ArtifactService(db);
    const artifact = await artifacts.createArtifact({
      actorUserId: owner,
      creatorInvocationId: required(p.row.invocations[0]).id,
      outputName: "result",
      type: "TEXT",
      classification: "PRIVATE",
      content: { kind: "INLINE_JSON", value: { text: "violet evidence" } },
    });
    await index("ARTIFACT", artifact.artifactId);
    await db.artifactAccessGrant.create({
      data: {
        artifactId: artifact.artifactId,
        granteeUserId: reader,
        permission: "READ",
      },
    });
    const readerPlan = await plan(reader);
    expect(
      (await search.retrieve(readerPlan.input)).map((hit) => hit.item.sourceId),
    ).toContain(artifact.artifactId);
    await db.artifactAccessGrant.updateMany({
      where: { artifactId: artifact.artifactId, granteeUserId: reader },
      data: { revokedAt: new Date() },
    });
    expect(await search.retrieve(readerPlan.input)).toEqual([]);
    await artifacts.createVersion({
      actorUserId: owner,
      artifactId: artifact.artifactId,
      expectedCurrentVersion: 1,
      content: { kind: "INLINE_JSON", value: { text: "green evidence" } },
    });
    expect(await countChunks("ARTIFACT:" + artifact.artifactId)).toBe(0);
  });
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture");
  return value;
}
