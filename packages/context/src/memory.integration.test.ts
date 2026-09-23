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
    const service = new MemoryService(db);
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

  it("keeps project memory audience-isolated and invalidates personal project-derived memory after access revoke", async () => {
    const owner = await user("project-owner");
    const member = await user("project-member");
    const outsider = await user("project-outsider");
    const project = await db.project.create({
      data: {
        ownerUserId: owner,
        name: "Memory Project",
        members: {
          create: { userId: member, role: "MEMBER" },
        },
      },
    });
    const service = new MemoryService(db);
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
      await new MemoryService(db).ingestCandidate({
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

  it("versions compacted state only after the effective budget threshold and invalidates it when raw provenance changes", async () => {
    const owner = await user("compaction-owner");
    const first = await message(
      owner,
      "Old history alpha",
    );
    const secondRow = await db.message.create({
      data: {
        conversationId: first.conversation.id,
        role: "ASSISTANT",
        status: "COMPLETE",
        content: "Old history beta",
      },
    });
    const service = new CompactedStateService(db);
    const refs = [
      {
        sourceType: "MESSAGE" as const,
        sourceId: first.row.id,
        sourceVersion:
          first.row.updatedAt.toISOString(),
        occurredAt: first.row.createdAt,
        sourceScopeKind: "CONVERSATION" as const,
        sourceScopeId: first.conversation.id,
      },
      {
        sourceType: "MESSAGE" as const,
        sourceId: secondRow.id,
        sourceVersion: secondRow.updatedAt.toISOString(),
        occurredAt: secondRow.createdAt,
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
        classification: "PRIVATE",
        content: "Too early summary",
        sourceRefs: refs,
        budget: compactBudget,
        inputTokenEstimate: 10,
        outputTokenEstimate: 5,
      }),
    ).rejects.toBeInstanceOf(MemoryError);

    const v1 = await service.refresh({
      actorUserId: owner,
      scope: {
        kind: "CONVERSATION",
        conversationId: first.conversation.id,
      },
      classification: "PRIVATE",
      content: "Alpha and beta summary",
      sourceRefs: refs,
      budget: compactBudget,
      inputTokenEstimate: 30,
      outputTokenEstimate: 8,
    });
    expect(v1.version).toBe(1);
    expect(v1.coveredFromSourceId).toBe(first.row.id);
    expect(v1.coveredToSourceId).toBe(secondRow.id);
    expect(v1.sourceCount).toBe(2);

    const v2 = await service.refresh({
      actorUserId: owner,
      scope: {
        kind: "CONVERSATION",
        conversationId: first.conversation.id,
      },
      classification: "PRIVATE",
      content: "Refined alpha and beta summary",
      sourceRefs: refs,
      budget: compactBudget,
      inputTokenEstimate: 30,
      outputTokenEstimate: 9,
    });
    expect(v2.version).toBe(2);
    expect(
      (
        await db.compactedContextState.findUnique({
          where: { id: v1.id },
        })
      )?.invalidationReason,
    ).toBe("SUPERSEDED");

    await db.message.update({
      where: { id: secondRow.id },
      data: { content: "Edited raw history" },
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
});
