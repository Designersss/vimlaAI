import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import {
  createPrismaClient,
  type PrismaClient,
} from "@vimla/database";
import type { ContextBudget } from "./budget.js";
import {
  CompactedStateService,
  canReadCompactedState,
} from "./compaction.js";
import {
  MemoryExtractionPipeline,
} from "./memory-extraction.js";
import {
  MemoryRetrievalProvider,
} from "./memory-retrieval.js";
import { ContextRetrievalService } from "./retrieval.js";
import { ContextSnapshotService } from "./service.js";
import {
  MemoryError,
  MemoryService,
  canReadMemoryItem,
} from "./memory.js";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error("TEST_DATABASE_URL is required");
}

let db: PrismaClient;

async function user(label = "memory") {
  const id = randomUUID();
  await db.user.create({
    data: {
      id,
      name: label,
      email: `${id}@example.test`,
      emailVerified: true,
    },
  });
  return id;
}

async function message(
  ownerUserId: string,
  content: string,
) {
  const conversation = await db.conversation.create({
    data: { userId: ownerUserId },
  });
  const row = await db.message.create({
    data: {
      conversationId: conversation.id,
      role: "USER",
      status: "COMPLETE",
      content,
    },
  });
  return { conversation, row };
}

function projectWriteAuthorizer() {
  return {
    canWriteProject: async (input: {
      actorUserId: string;
      projectId: string;
    }): Promise<boolean> => {
      const membership = await db.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId: input.projectId,
            userId: input.actorUserId,
          },
        },
        select: { role: true },
      });
      return (
        membership?.role === "OWNER" ||
        membership?.role === "ADMIN"
      );
    },
  };
}


const compactBudget: ContextBudget = {
  contextWindowTokens: 100,
  outputReserveTokens: 10,
  systemToolReserveTokens: 10,
  artifactReserveTokens: 10,
  safetyMarginTokens: 10,
  effectiveHistoryBudgetTokens: 60,
  compactedStateTriggerTokens: 20,
};

describe("durable memory context graph", () => {
  beforeAll(() => {
    db = createPrismaClient(url);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("supersedes inferred preferences, lets user correction win, and serializes concurrent slot writes", async () => {
    const owner = await user("preference-owner");
    const memory = new MemoryService(db);
    const extraction = new MemoryExtractionPipeline(memory);
    const firstSource = await message(
      owner,
      "I prefer concise answers.",
    );

    const first = await extraction.process({
      actorUserId: owner,
      scope: { kind: "PERSONAL" },
      type: "USER_PREFERENCE",
      slotKey: "answer style",
      content: "Prefers concise answers",
      confidence: 0.8,
      quality: 0.8,
      sourceRefs: [
        {
          provenance: "AUTO_EXTRACTION",
          sourceType: "MESSAGE",
          sourceId: firstSource.row.id,
          sourceVersion:
            firstSource.row.updatedAt.toISOString(),
          sourceScopeKind: "CONVERSATION",
          sourceScopeId: firstSource.conversation.id,
        },
      ],
    });
    expect(first.kind).toBe("STORED");

    const secondSource = await message(
      owner,
      "Actually, I prefer detailed answers.",
    );
    const second = await extraction.process({
      actorUserId: owner,
      scope: { kind: "PERSONAL" },
      type: "USER_PREFERENCE",
      slotKey: "answer style",
      content: "Prefers detailed answers",
      confidence: 0.9,
      quality: 0.9,
      sourceRefs: [
        {
          provenance: "AUTO_EXTRACTION",
          sourceType: "MESSAGE",
          sourceId: secondSource.row.id,
          sourceVersion:
            secondSource.row.updatedAt.toISOString(),
          sourceScopeKind: "CONVERSATION",
          sourceScopeId: secondSource.conversation.id,
        },
      ],
    });
    expect(second.kind).toBe("STORED");
    if (second.kind !== "STORED") {
      throw new Error("expected stored memory");
    }

    const oldRows = await db.memoryItem.findMany({
      where: {
        ownerUserId: owner,
        slotKey: "answer style",
      },
      orderBy: { generation: "asc" },
    });
    expect(oldRows.map((row) => row.state)).toEqual([
      "SUPERSEDED",
      "ACTIVE",
    ]);
    expect(oldRows.map((row) => row.generation)).toEqual([
      1,
      2,
    ]);

    const corrected = await memory.correctPersonal(
      owner,
      second.memory.id,
      { content: "Prefers concise technical answers" },
    );
    expect(corrected.origin).toBe("USER_CORRECTION");
    expect(corrected.userCorrectedAt).not.toBeNull();

    const laterSource = await message(
      owner,
      "Maybe give me very long answers.",
    );
    const ignored = await extraction.process({
      actorUserId: owner,
      scope: { kind: "PERSONAL" },
      type: "USER_PREFERENCE",
      slotKey: "answer style",
      content: "Prefers very long answers",
      confidence: 1,
      quality: 1,
      sourceRefs: [
        {
          provenance: "AUTO_EXTRACTION",
          sourceType: "MESSAGE",
          sourceId: laterSource.row.id,
          sourceVersion:
            laterSource.row.updatedAt.toISOString(),
          sourceScopeKind: "CONVERSATION",
          sourceScopeId: laterSource.conversation.id,
        },
      ],
    });
    expect(ignored.kind).toBe("STORED");
    if (ignored.kind !== "STORED") {
      throw new Error("expected stored result");
    }
    expect(ignored.memory.id).toBe(corrected.id);
    expect(ignored.memory.content).toBe(
      "Prefers concise technical answers",
    );

    const concurrentOwner = await user("concurrent-owner");
    const service = new MemoryService(
      db,
      projectWriteAuthorizer(),
    );
    const [left, right] = await Promise.all([
      service.ingestCandidate({
        actorUserId: concurrentOwner,
        scope: { kind: "PERSONAL" },
        type: "USER_GOAL",
        slotKey: "primary goal",
        content: "Ship version A",
        origin: "USER_EXPLICIT",
        sourceRefs: [
          {
            provenance: "USER_EXPLICIT",
            sourceType: "USER_EXPLICIT",
            sourceId: randomUUID(),
            sourceScopeKind: "PERSONAL",
            sourceScopeId: concurrentOwner,
          },
        ],
      }),
      service.ingestCandidate({
        actorUserId: concurrentOwner,
        scope: { kind: "PERSONAL" },
        type: "USER_GOAL",
        slotKey: "primary goal",
        content: "Ship version B",
        origin: "USER_EXPLICIT",
        sourceRefs: [
          {
            provenance: "USER_EXPLICIT",
            sourceType: "USER_EXPLICIT",
            sourceId: randomUUID(),
            sourceScopeKind: "PERSONAL",
            sourceScopeId: concurrentOwner,
          },
        ],
      }),
    ]);
    expect(left.id).not.toBe(right.id);
    const concurrentRows = await db.memoryItem.findMany({
      where: {
        ownerUserId: concurrentOwner,
        slotKey: "primary goal",
      },
      orderBy: { generation: "asc" },
    });
    expect(concurrentRows).toHaveLength(2);
    expect(
      concurrentRows.filter((row) => row.state === "ACTIVE"),
    ).toHaveLength(1);
    expect(concurrentRows.map((row) => row.generation)).toEqual([
      1,
      2,
    ]);
  });

  it("rejects secret/transient/E2EE automatic candidates and invalidates stale source-derived memory", async () => {
    const owner = await user("safe-extraction");
    const memory = new MemoryService(db);
    const extraction = new MemoryExtractionPipeline(memory);
    const source = await message(owner, "Normal source fact");

    expect(
      await extraction.process({
        actorUserId: owner,
        scope: { kind: "PERSONAL" },
        type: "USER_FACT",
        slotKey: "medical",
        content: "Has a long-term medical condition",
        sensitivity: "SENSITIVE",
        confidence: 0.99,
        sourceRefs: [
          {
            provenance: "AUTO_EXTRACTION",
            sourceType: "MESSAGE",
            sourceId: source.row.id,
            sourceVersion: source.row.updatedAt.toISOString(),
            sourceScopeKind: "CONVERSATION",
            sourceScopeId: source.conversation.id,
          },
        ],
      }),
    ).toEqual({ kind: "SKIPPED", reason: "SENSITIVE" });

    expect(
      await extraction.process({
        actorUserId: owner,
        scope: { kind: "PERSONAL" },
        type: "USER_FACT",
        slotKey: "temporary",
        content: "temporary one-off request",
        transient: true,
        sourceRefs: [
          {
            provenance: "AUTO_EXTRACTION",
            sourceType: "MESSAGE",
            sourceId: source.row.id,
            sourceVersion: source.row.updatedAt.toISOString(),
            sourceScopeKind: "CONVERSATION",
            sourceScopeId: source.conversation.id,
          },
        ],
      }),
    ).toEqual({ kind: "SKIPPED", reason: "TRANSIENT" });

    expect(
      await extraction.process({
        actorUserId: owner,
        scope: { kind: "PERSONAL" },
        type: "USER_FACT",
        slotKey: "weak inference",
        content: "Possibly a durable fact",
        confidence: 0.6,
        sourceRefs: [
          {
            provenance: "AUTO_EXTRACTION",
            sourceType: "MESSAGE",
            sourceId: source.row.id,
            sourceVersion: source.row.updatedAt.toISOString(),
            sourceScopeKind: "CONVERSATION",
            sourceScopeId: source.conversation.id,
          },
        ],
      }),
    ).toEqual({
      kind: "SKIPPED",
      reason: "LOW_CONFIDENCE",
    });

    expect(
      await extraction.process({
        actorUserId: owner,
        scope: { kind: "PERSONAL" },
        type: "USER_FACT",
        slotKey: "credential",
        content:
          "api_key=sk-super-sensitive-credential-value-123456789",
        sourceRefs: [
          {
            provenance: "AUTO_EXTRACTION",
            sourceType: "MESSAGE",
            sourceId: source.row.id,
            sourceVersion: source.row.updatedAt.toISOString(),
            sourceScopeKind: "CONVERSATION",
            sourceScopeId: source.conversation.id,
          },
        ],
      }),
    ).toEqual({ kind: "SKIPPED", reason: "SENSITIVE" });

    expect(
      await extraction.process({
        actorUserId: owner,
        scope: { kind: "PERSONAL" },
        type: "USER_FACT",
        slotKey: "direct chat",
        content: "ordinary Direct Chat fact",
        sourceRefs: [
          {
            provenance: "AUTO_EXTRACTION",
            sourceType: "MESSAGE",
            sourceId: randomUUID(),
            sourceScopeKind: "DIRECT_CHAT",
            sourceScopeId: randomUUID(),
          },
        ],
      }),
    ).toEqual({
      kind: "SKIPPED",
      reason: "E2EE_AUTOMATIC_DISABLED",
    });

    const stored = await extraction.process({
      actorUserId: owner,
      scope: { kind: "PERSONAL" },
      type: "USER_FACT",
      slotKey: "source-backed fact",
      content: "The current source-backed fact",
      sourceRefs: [
        {
          provenance: "AUTO_EXTRACTION",
          sourceType: "MESSAGE",
          sourceId: source.row.id,
          sourceVersion: source.row.updatedAt.toISOString(),
          sourceScopeKind: "CONVERSATION",
          sourceScopeId: source.conversation.id,
        },
      ],
    });
    expect(stored.kind).toBe("STORED");
    if (stored.kind !== "STORED") {
      throw new Error("expected stored memory");
    }

    await db.message.update({
      where: { id: source.row.id },
      data: { content: "Source changed" },
    });
    const provider = new MemoryRetrievalProvider(db);
    const hits = await provider.retrieve({
      actorUserId: owner,
      planId: randomUUID(),
      query: "source-backed fact",
      conversationId: source.conversation.id,
      sourceMessageId: source.row.id,
      sourceMessageCreatedAt:
        source.row.createdAt.toISOString(),
    });
    expect(hits.map((hit) => hit.item.sourceId)).not.toContain(
      stored.memory.id,
    );
    expect(
      (
        await db.memoryItem.findUnique({
          where: { id: stored.memory.id },
        })
      )?.state,
    ).toBe("INVALIDATED");
  });

  it("integrates current durable memory into immutable ContextSnapshot retrieval as DERIVED evidence", async () => {
    const owner = await user("snapshot-memory-owner");
    const service = new MemoryService(db);
    const remembered = await service.rememberPersonal({
      actorUserId: owner,
      type: "USER_PREFERENCE",
      slotKey: "answer style",
      content: "Prefers concise technical answers",
    });
    const current = await message(
      owner,
      "What is my answer style preference?",
    );
    const planId = randomUUID();
    await db.executionPlan.create({
      data: {
        id: planId,
        messageId: current.row.id,
        userId: owner,
        conversationId: current.conversation.id,
        schemaVersion: 1,
        version: 1,
        planHash: "planning:pending:v1",
        goal: "Use durable preference",
        status: "PLANNING",
        maxParallelism: 1,
      },
    });

    const snapshots = new ContextSnapshotService(
      db,
      undefined,
      new ContextRetrievalService(db, [
        new MemoryRetrievalProvider(db),
      ]),
    );
    const snapshot = await snapshots.createForExecutionPlan({
      actorUserId: owner,
      planId,
    });
    const memoryItem = snapshot.items.find(
      (item) => item.sourceId === remembered.id,
    );
    expect(memoryItem?.sourceType).toBe("MEMORY");
    expect(memoryItem?.metadata).toMatchObject({
      content: "Prefers concise technical answers",
      retrieval: {
        sourceKind: "PERSONAL_MEMORY",
        authority: "DERIVED",
      },
    });
    await expect(
      snapshots.resolveForPlan(owner, planId),
    ).resolves.toMatchObject({ id: snapshot.id });

    await service.invalidatePersonal(
      owner,
      remembered.id,
      "TEST_INVALIDATION",
    );
    await expect(
      snapshots.resolveForPlan(owner, planId),
    ).rejects.toThrow();
  });

  it("keeps project memory audience-isolated and invalidates personal project-derived memory after access revoke", async () => {
    const owner = await user("project-owner");
    const member = await user("project-member");
    const viewer = await user("project-viewer");
    const outsider = await user("project-outsider");
    const project = await db.project.create({
      data: {
        ownerUserId: owner,
        name: "Memory Project",
        members: {
          create: [
            { userId: owner, role: "OWNER" },
            { userId: member, role: "ADMIN" },
            { userId: viewer, role: "MEMBER" },
          ],
        },
      },
    });
    const service = new MemoryService(
      db,
      projectWriteAuthorizer(),
    );
    const projectMemory = await service.ingestCandidate({
      actorUserId: owner,
      scope: { kind: "PROJECT", projectId: project.id },
      type: "PROJECT_FACT",
      slotKey: "launch region",
      content: "Launch region is EU",
      origin: "USER_EXPLICIT",
      sourceRefs: [
        {
          provenance: "USER_EXPLICIT",
          sourceType: "PROJECT",
          sourceId: project.id,
          sourceVersion: project.updatedAt.toISOString(),
          sourceScopeKind: "PROJECT",
          sourceScopeId: project.id,
        },
      ],
    });

    const memberProvider = new MemoryRetrievalProvider(db);
    const memberHits = await memberProvider.retrieve({
      actorUserId: member,
      planId: randomUUID(),
      query: "launch region",
      conversationId: randomUUID(),
      sourceMessageId: randomUUID(),
      sourceMessageCreatedAt: new Date().toISOString(),
    });
    expect(
      memberHits.map((hit) => hit.item.sourceId),
    ).toContain(projectMemory.id);

    const outsiderHits = await new MemoryRetrievalProvider(
      db,
    ).retrieve({
      actorUserId: outsider,
      planId: randomUUID(),
      query: "launch region",
      conversationId: randomUUID(),
      sourceMessageId: randomUUID(),
      sourceMessageCreatedAt: new Date().toISOString(),
    });
    expect(outsiderHits).toEqual([]);

    const memberAuthoredProjectMemory =
      await service.ingestCandidate({
        actorUserId: member,
        scope: { kind: "PROJECT", projectId: project.id },
        type: "PROJECT_DECISION",
        slotKey: "member-authored decision",
        content: "The project decision remains with the project",
        origin: "USER_EXPLICIT",
        sourceRefs: [
          {
            provenance: "USER_EXPLICIT",
            sourceType: "PROJECT",
            sourceId: project.id,
            sourceVersion: project.updatedAt.toISOString(),
            sourceScopeKind: "PROJECT",
            sourceScopeId: project.id,
          },
        ],
      });

    await expect(
      service.ingestCandidate({
        actorUserId: viewer,
        scope: { kind: "PROJECT", projectId: project.id },
        type: "PROJECT_FACT",
        slotKey: "viewer-forbidden",
        content: "Member must not mutate Project Memory",
        origin: "USER_EXPLICIT",
        sourceRefs: [
          {
            provenance: "USER_EXPLICIT",
            sourceType: "PROJECT",
            sourceId: project.id,
            sourceVersion: project.updatedAt.toISOString(),
            sourceScopeKind: "PROJECT",
            sourceScopeId: project.id,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const personalFromProject =
      await new MemoryService(db).ingestCandidate({
        actorUserId: member,
        scope: { kind: "PERSONAL" },
        type: "USER_FACT",
        slotKey: "project-related personal fact",
        content: "I work on Memory Project",
        origin: "AUTO_EXTRACTION",
        sourceRefs: [
          {
            provenance: "AUTO_EXTRACTION",
            sourceType: "PROJECT",
            sourceId: project.id,
            sourceVersion: project.updatedAt.toISOString(),
            sourceScopeKind: "PROJECT",
            sourceScopeId: project.id,
          },
        ],
      });

    await db.projectMember.delete({
      where: {
        projectId_userId: {
          projectId: project.id,
          userId: member,
        },
      },
    });

    expect(
      await canReadMemoryItem(db, member, projectMemory.id),
    ).toBe(false);
    expect(
      await canReadMemoryItem(
        db,
        member,
        personalFromProject.id,
      ),
    ).toBe(false);
    expect(
      (
        await db.memoryItem.findUnique({
          where: { id: personalFromProject.id },
        })
      )?.state,
    ).toBe("INVALIDATED");
    expect(
      await canReadMemoryItem(db, owner, projectMemory.id),
    ).toBe(true);
    expect(
      await canReadMemoryItem(
        db,
        owner,
        memberAuthoredProjectMemory.id,
      ),
    ).toBe(true);
  });

  it("keeps same-content automatic memory current while any bounded supporting source remains current", async () => {
    const owner = await user("multi-source-owner");
    const service = new MemoryService(db);
    const first = await message(owner, "I prefer concise output.");
    const second = await message(owner, "I prefer concise output.");

    const stored = await service.ingestCandidate({
      actorUserId: owner,
      scope: { kind: "PERSONAL" },
      type: "USER_PREFERENCE",
      slotKey: "output style",
      content: "Prefers concise output",
      origin: "AUTO_EXTRACTION",
      sourceRefs: [
        {
          provenance: "AUTO_EXTRACTION",
          sourceType: "MESSAGE",
          sourceId: first.row.id,
          sourceVersion: first.row.updatedAt.toISOString(),
          sourceScopeKind: "CONVERSATION",
          sourceScopeId: first.conversation.id,
        },
      ],
    });
    const refreshed = await service.ingestCandidate({
      actorUserId: owner,
      scope: { kind: "PERSONAL" },
      type: "USER_PREFERENCE",
      slotKey: "output style",
      content: "Prefers concise output",
      origin: "AUTO_EXTRACTION",
      sourceRefs: [
        {
          provenance: "AUTO_EXTRACTION",
          sourceType: "MESSAGE",
          sourceId: second.row.id,
          sourceVersion: second.row.updatedAt.toISOString(),
          sourceScopeKind: "CONVERSATION",
          sourceScopeId: second.conversation.id,
        },
      ],
    });
    expect(refreshed.id).toBe(stored.id);
    expect(
      await db.memorySourceRef.count({
        where: { memoryId: stored.id },
      }),
    ).toBe(2);

    await db.message.update({
      where: { id: first.row.id },
      data: {
        content: "Edited first supporting source",
        updatedAt: new Date(Date.now() + 1_000),
      },
    });
    await expect(
      canReadMemoryItem(db, owner, stored.id),
    ).resolves.toBe(true);

    await db.message.update({
      where: { id: second.row.id },
      data: {
        content: "Edited second supporting source",
        updatedAt: new Date(Date.now() + 2_000),
      },
    });
    await expect(
      canReadMemoryItem(db, owner, stored.id),
    ).resolves.toBe(false);
  });

  it("rejects cross-conversation Memory and L2 provenance even for the same owner", async () => {
    const owner = await user("conversation-scope-owner");
    const target = await db.conversation.create({
      data: { userId: owner, kind: "CHAT" },
    });
    const foreign = await message(
      owner,
      "Source belongs to a different conversation.",
    );
    const memory = new MemoryService(db);

    await expect(
      memory.ingestCandidate({
        actorUserId: owner,
        scope: {
          kind: "CONVERSATION",
          conversationId: target.id,
        },
        type: "CONVERSATION_STATE",
        slotKey: "state",
        content: "Must not cross conversations",
        origin: "AUTO_EXTRACTION",
        sourceRefs: [
          {
            provenance: "AUTO_EXTRACTION",
            sourceType: "MESSAGE",
            sourceId: foreign.row.id,
            sourceVersion: foreign.row.updatedAt.toISOString(),
            sourceScopeKind: "CONVERSATION",
            sourceScopeId: foreign.conversation.id,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      new CompactedStateService(db).refresh({
        actorUserId: owner,
        scope: {
          kind: "CONVERSATION",
          conversationId: target.id,
        },
        classification: "PRIVATE",
        content: "Must not cross conversations",
        sourceRefs: [
          {
            sourceType: "MESSAGE",
            sourceId: foreign.row.id,
            sourceVersion: foreign.row.updatedAt.toISOString(),
            occurredAt: foreign.row.createdAt,
            sourceScopeKind: "CONVERSATION",
            sourceScopeId: foreign.conversation.id,
          },
        ],
        budget: compactBudget,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("marks authorized current-project Memory as current-project derived context", async () => {
    const owner = await user("current-project-owner");
    const project = await db.project.create({
      data: {
        ownerUserId: owner,
        name: "Current Project",
        members: {
          create: {
            userId: owner,
            role: "OWNER",
          },
        },
      },
    });
    const memory = await new MemoryService(
      db,
      projectWriteAuthorizer(),
    ).rememberProject({
      actorUserId: owner,
      projectId: project.id,
      type: "PROJECT_FACT",
      slotKey: "launch region",
      content: "Launch region is Europe",
    });

    const hits = await new MemoryRetrievalProvider(db).retrieve({
      actorUserId: owner,
      planId: randomUUID(),
      query: "launch region",
      conversationId: randomUUID(),
      sourceMessageId: randomUUID(),
      sourceMessageCreatedAt: new Date().toISOString(),
      currentProjectId: project.id,
    });
    const hit = hits.find(
      (candidate) => candidate.item.sourceId === memory.id,
    );
    expect(hit?.currentProject).toBe(true);
    expect(hit?.sourceKind).toBe("PROJECT_MEMORY");
  });

  it("promotes only an explicit E2EE fact with disclosure provenance", async () => {
    const actor = await user("e2ee-memory-owner");
    const peer = await user("e2ee-memory-peer");
    const outsider = await user("e2ee-memory-outsider");
    const device = await db.userCryptoDevice.create({
      data: {
        userId: actor,
        identityEd25519Public: "ed25519-public",
        identityX25519Public: "x25519-public",
        signedPrekeyId: 1,
        signedPrekeyPublic: "signed-prekey",
        signedPrekeySignature: "signature",
      },
    });
    const conversation = await db.directConversation.create({
      data: {
        pairKey: [actor, peer].sort().join(":"),
        members: {
          create: [
            { userId: actor },
            { userId: peer },
          ],
        },
      },
    });
    const source = await db.directMessage.create({
      data: {
        conversationId: conversation.id,
        senderUserId: actor,
        senderDeviceId: device.id,
        clientMessageId: randomUUID(),
        kind: "HUMAN",
      },
    });

    const promoted =
      await new MemoryService(db).promoteE2eeDisclosure({
        actorUserId: actor,
        directConversationId: conversation.id,
        sourceMessageId: source.id,
        type: "USER_PREFERENCE",
        slotKey: "coffee",
        content: "Prefers black coffee",
      });
    expect(promoted.origin).toBe("E2EE_USER_DISCLOSURE");
    expect(promoted.content).toBe("Prefers black coffee");
    const persisted = await db.memoryItem.findUniqueOrThrow({
      where: { id: promoted.id },
      include: { sourceRefs: true },
    });
    expect(persisted.sourceRefs).toHaveLength(1);
    expect(persisted.sourceRefs[0]).toMatchObject({
      provenance: "E2EE_USER_DISCLOSURE",
      sourceType: "E2EE_USER_DISCLOSURE",
      sourceId: source.id,
      sourceScopeKind: "DIRECT_CHAT",
      sourceScopeId: conversation.id,
    });
    expect(JSON.stringify(persisted)).not.toContain(
      "unrelated Direct Chat plaintext",
    );

    await expect(
      new MemoryService(db).promoteE2eeDisclosure({
        actorUserId: outsider,
        directConversationId: conversation.id,
        sourceMessageId: source.id,
        type: "USER_FACT",
        slotKey: "stolen",
        content: "Should not be promoted",
      }),
    ).rejects.toBeInstanceOf(MemoryError);
  });

  it("versions incremental compacted state from authoritative pressure and recursively invalidates stale raw provenance", async () => {
    const owner = await user("compaction-owner");
    const first = await message(
      owner,
      "Old history alpha with enough content.",
    );
    const secondRow = await db.message.create({
      data: {
        conversationId: first.conversation.id,
        role: "ASSISTANT",
        status: "COMPLETE",
        content: "Old history beta with enough content.",
      },
    });
    const service = new CompactedStateService(db);
    const refs = [
      {
        sourceType: "MESSAGE" as const,
        sourceId: first.row.id,
        sourceVersion:
          first.row.updatedAt.toISOString(),
        occurredAt: new Date(0),
        sourceScopeKind: "CONVERSATION" as const,
        sourceScopeId: first.conversation.id,
      },
      {
        sourceType: "MESSAGE" as const,
        sourceId: secondRow.id,
        sourceVersion: secondRow.updatedAt.toISOString(),
        occurredAt: new Date(0),
        sourceScopeKind: "CONVERSATION" as const,
        sourceScopeId: first.conversation.id,
      },
    ];

    await expect(
      service.refresh({
        actorUserId: owner,
        scope: {
          kind: "CONVERSATION",
          conversationId: first.conversation.id,
        },
        classification: "PUBLIC",
        content: "Too early summary",
        sourceRefs: refs,
        budget: {
          ...compactBudget,
          compactedStateTriggerTokens: 10_000,
        },
        inputTokenEstimate: 999_999,
        outputTokenEstimate: 999_999,
      }),
    ).rejects.toBeInstanceOf(MemoryError);

    const v1 = await service.refresh({
      actorUserId: owner,
      scope: {
        kind: "CONVERSATION",
        conversationId: first.conversation.id,
      },
      classification: "PUBLIC",
      content: "Alpha and beta summary",
      sourceRefs: refs,
      budget: compactBudget,
      inputTokenEstimate: 1,
      outputTokenEstimate: 1,
    });
    expect(v1.version).toBe(1);
    expect(v1.classification).toBe("PRIVATE");
    expect(v1.coveredFromSourceId).toBe(first.row.id);
    expect(v1.coveredToSourceId).toBe(secondRow.id);
    expect(v1.sourceCount).toBe(2);

    const thirdRow = await db.message.create({
      data: {
        conversationId: first.conversation.id,
        role: "USER",
        status: "COMPLETE",
        content: "New older segment gamma with enough content.",
      },
    });
    const v2 = await service.refresh({
      actorUserId: owner,
      scope: {
        kind: "CONVERSATION",
        conversationId: first.conversation.id,
      },
      classification: "PUBLIC",
      content: "Alpha beta and gamma summary",
      sourceRefs: [
        {
          sourceType: "COMPACTED_STATE",
          sourceId: v1.id,
          sourceVersion: String(v1.version),
          occurredAt: new Date(0),
          sourceScopeKind: "CONVERSATION",
          sourceScopeId: first.conversation.id,
        },
        {
          sourceType: "MESSAGE",
          sourceId: thirdRow.id,
          sourceVersion: thirdRow.updatedAt.toISOString(),
          occurredAt: new Date(0),
          sourceScopeKind: "CONVERSATION",
          sourceScopeId: first.conversation.id,
        },
      ],
      budget: compactBudget,
    });
    expect(v2.version).toBe(2);
    expect(v2.sourceCount).toBe(3);
    expect(v2.coveredFromSourceId).toBe(first.row.id);
    expect(v2.coveredToSourceId).toBe(thirdRow.id);
    expect(
      (
        await db.compactedContextState.findUnique({
          where: { id: v1.id },
        })
      )?.invalidationReason,
    ).toBe("SUPERSEDED");
    await expect(
      canReadCompactedState(db, owner, v2.id),
    ).resolves.toBe(true);

    await db.message.update({
      where: { id: first.row.id },
      data: {
        content: "Edited raw history",
        updatedAt: new Date(Date.now() + 1_000),
      },
    });
    expect(
      await canReadCompactedState(db, owner, v2.id),
    ).toBe(false);
    expect(
      (
        await db.compactedContextState.findUnique({
          where: { id: v2.id },
        })
      )?.invalidationReason,
    ).toBe("SOURCE_STALE_OR_INACCESSIBLE");
  });

  it("rejects missing versions and forged scopes while preventing classification downgrade", async () => {
    const owner = await user("provenance-owner");
    const source = await message(
      owner,
      "I prefer source-backed technical answers.",
    );
    const service = new MemoryService(db);

    await expect(
      service.ingestCandidate({
        actorUserId: owner,
        scope: { kind: "PERSONAL" },
        type: "USER_PREFERENCE",
        slotKey: "version-required",
        content: "Prefers technical answers",
        classification: "PUBLIC",
        origin: "AUTO_EXTRACTION",
        sourceRefs: [
          {
            provenance: "AUTO_EXTRACTION",
            sourceType: "MESSAGE",
            sourceId: source.row.id,
            sourceScopeKind: "CONVERSATION",
            sourceScopeId: source.conversation.id,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      service.ingestCandidate({
        actorUserId: owner,
        scope: { kind: "PERSONAL" },
        type: "USER_PREFERENCE",
        slotKey: "forged-scope",
        content: "Prefers technical answers",
        origin: "AUTO_EXTRACTION",
        sourceRefs: [
          {
            provenance: "AUTO_EXTRACTION",
            sourceType: "MESSAGE",
            sourceId: source.row.id,
            sourceVersion:
              source.row.updatedAt.toISOString(),
            sourceScopeKind: "PROJECT",
            sourceScopeId: randomUUID(),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const stored = await service.ingestCandidate({
      actorUserId: owner,
      scope: { kind: "PERSONAL" },
      type: "USER_PREFERENCE",
      slotKey: "classification",
      content: "Prefers technical answers",
      classification: "PUBLIC",
      origin: "AUTO_EXTRACTION",
      sourceRefs: [
        {
          provenance: "AUTO_EXTRACTION",
          sourceType: "MESSAGE",
          sourceId: source.row.id,
          sourceVersion:
            source.row.updatedAt.toISOString(),
          sourceScopeKind: "CONVERSATION",
          sourceScopeId: source.conversation.id,
        },
      ],
    });
    expect(stored.classification).toBe("PRIVATE");

    const updatedSource = await db.message.update({
      where: { id: source.row.id },
      data: {
        content:
          "I still prefer source-backed technical answers.",
        updatedAt: new Date(Date.now() + 1_000),
      },
    });
    const refreshed = await service.ingestCandidate({
      actorUserId: owner,
      scope: { kind: "PERSONAL" },
      type: "USER_PREFERENCE",
      slotKey: "classification",
      content: "Prefers technical answers",
      classification: "PUBLIC",
      origin: "AUTO_EXTRACTION",
      sourceRefs: [
        {
          provenance: "AUTO_EXTRACTION",
          sourceType: "MESSAGE",
          sourceId: source.row.id,
          sourceVersion:
            updatedSource.updatedAt.toISOString(),
          sourceScopeKind: "CONVERSATION",
          sourceScopeId: source.conversation.id,
        },
      ],
    });
    expect(refreshed.id).toBe(stored.id);
    expect(
      (
        await db.memorySourceRef.findFirstOrThrow({
          where: {
            memoryId: stored.id,
            sourceId: source.row.id,
          },
        })
      ).sourceVersion,
    ).toBe(updatedSource.updatedAt.toISOString());
    await expect(
      canReadMemoryItem(db, owner, stored.id),
    ).resolves.toBe(true);
  });

  it("turns explicit confirmation into independent truth and redacts the whole deleted lineage", async () => {
    const owner = await user("confirmation-owner");
    const source = await message(
      owner,
      "I prefer concise answers.",
    );
    const service = new MemoryService(db);
    const inferred = await service.ingestCandidate({
      actorUserId: owner,
      scope: { kind: "PERSONAL" },
      type: "USER_PREFERENCE",
      slotKey: "answer style",
      content: "Prefers concise answers",
      origin: "AUTO_EXTRACTION",
      sourceRefs: [
        {
          provenance: "AUTO_EXTRACTION",
          sourceType: "MESSAGE",
          sourceId: source.row.id,
          sourceVersion:
            source.row.updatedAt.toISOString(),
          sourceScopeKind: "CONVERSATION",
          sourceScopeId: source.conversation.id,
        },
      ],
    });
    const confirmed = await service.rememberPersonal({
      actorUserId: owner,
      type: "USER_PREFERENCE",
      slotKey: "answer style",
      content: "Prefers concise answers",
    });
    expect(confirmed.id).not.toBe(inferred.id);
    expect(confirmed.origin).toBe("USER_EXPLICIT");

    await db.message.update({
      where: { id: source.row.id },
      data: {
        content: "Source was edited later.",
        updatedAt: new Date(Date.now() + 2_000),
      },
    });
    await expect(
      canReadMemoryItem(db, owner, confirmed.id),
    ).resolves.toBe(true);

    const expiresAt = new Date(Date.now() + 86_400_000);
    const corrected = await service.correctPersonal(
      owner,
      confirmed.id,
      {
        content: "Prefers concise answers",
        expiresAt,
      },
    );
    expect(corrected.id).not.toBe(confirmed.id);
    expect(corrected.expiresAt).toBe(
      expiresAt.toISOString(),
    );

    await service.invalidatePersonal(owner, corrected.id);
    const lineage = await db.memoryItem.findMany({
      where: {
        id: {
          in: [inferred.id, confirmed.id, corrected.id],
        },
      },
    });
    expect(lineage).toHaveLength(3);
    for (const row of lineage) {
      expect(row.content).toBe("");
      expect(row.slotKey).toBe(`deleted:${row.id}`);
    }
    expect(
      lineage.find((row) => row.id === corrected.id)?.state,
    ).toBe("INVALIDATED");
    await expect(
      service.getPersonal(owner, corrected.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("paginates through stale rows and enforces the active personal storage cap", async () => {
    const owner = await user("pagination-owner");
    const service = new MemoryService(db);
    const older = await service.rememberPersonal({
      actorUserId: owner,
      type: "USER_FACT",
      slotKey: "older-valid",
      content: "Older valid fact",
    });
    const source = await message(
      owner,
      "Newest source-backed fact",
    );
    const newest = await service.ingestCandidate({
      actorUserId: owner,
      scope: { kind: "PERSONAL" },
      type: "USER_FACT",
      slotKey: "newest-stale",
      content: "Newest source-backed fact",
      origin: "AUTO_EXTRACTION",
      validFrom: new Date(Date.now() + 5_000),
      sourceRefs: [
        {
          provenance: "AUTO_EXTRACTION",
          sourceType: "MESSAGE",
          sourceId: source.row.id,
          sourceVersion:
            source.row.updatedAt.toISOString(),
          sourceScopeKind: "CONVERSATION",
          sourceScopeId: source.conversation.id,
        },
      ],
    });
    await db.message.update({
      where: { id: source.row.id },
      data: {
        content: "Changed",
        updatedAt: new Date(Date.now() + 6_000),
      },
    });
    const page = await service.listPersonal(owner, {
      limit: 1,
    });
    expect(page.items.map((item) => item.id)).toEqual([
      older.id,
    ]);
    expect(
      (
        await db.memoryItem.findUnique({
          where: { id: newest.id },
        })
      )?.state,
    ).toBe("INVALIDATED");

    const cappedOwner = await user("capped-owner");
    const capped = new MemoryService(
      db,
      undefined,
      1,
    );
    await capped.rememberPersonal({
      actorUserId: cappedOwner,
      type: "USER_FACT",
      slotKey: "one",
      content: "First fact",
    });
    await expect(
      capped.rememberPersonal({
        actorUserId: cappedOwner,
        type: "USER_GOAL",
        slotKey: "two",
        content: "Second fact",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("fails closed for THREAD memory and rejects forged compaction message scopes", async () => {
    const owner = await user("thread-owner");
    const memory = new MemoryService(db);
    await expect(
      memory.ingestCandidate({
        actorUserId: owner,
        scope: { kind: "THREAD", threadId: randomUUID() },
        type: "THREAD_STATE",
        slotKey: "state",
        content: "Must wait for PR-18",
        origin: "USER_EXPLICIT",
        sourceRefs: [
          {
            provenance: "USER_EXPLICIT",
            sourceType: "USER_EXPLICIT",
            sourceId: randomUUID(),
            sourceScopeKind: "PERSONAL",
            sourceScopeId: owner,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "DISABLED" });

    const source = await message(
      owner,
      "Long enough raw history for forged compaction scope.",
    );
    await expect(
      new CompactedStateService(db).refresh({
        actorUserId: owner,
        scope: {
          kind: "CONVERSATION",
          conversationId: source.conversation.id,
        },
        classification: "PUBLIC",
        content: "Summary",
        sourceRefs: [
          {
            sourceType: "MESSAGE",
            sourceId: source.row.id,
            sourceVersion:
              source.row.updatedAt.toISOString(),
            occurredAt: new Date(0),
            sourceScopeKind: "PROJECT",
            sourceScopeId: randomUUID(),
          },
        ],
        budget: compactBudget,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

});
