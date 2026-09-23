import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArtifactService } from "@vimla/artifacts";
import { createPrismaClient, type PrismaClient } from "@vimla/database";
import { ContextValidationError } from "./errors.js";
import { ContextRetrievalService } from "./retrieval.js";
import { ContextSnapshotService } from "./service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

describe("Context retrieval v1", () => {
  let prisma: PrismaClient;
  let snapshots: ContextSnapshotService;

  beforeAll(() => {
    prisma = createPrismaClient(testDatabaseUrl);
    snapshots = new ContextSnapshotService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("retrieves relevant older and cross-conversation context outside the L1 raw tail", async () => {
    const actorUserId = await createUser(prisma, "retrieval");
    const conversation = await prisma.conversation.create({
      data: {
        userId: actorUserId,
        title: "Current release discussion",
      },
    });
    const older = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content:
          "For Zephyr release we decided the violet checklist must include the rollout gate.",
        status: "COMPLETE",
      },
    });

    for (let index = 0; index < 30; index += 1) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: index % 2 === 0 ? "USER" : "ASSISTANT",
          content: "Unrelated filler message " + index,
          status: "COMPLETE",
        },
      });
    }

    const otherConversation = await prisma.conversation.create({
      data: {
        userId: actorUserId,
        title: "Earlier Zephyr design",
      },
    });
    const crossConversation = await prisma.message.create({
      data: {
        conversationId: otherConversation.id,
        role: "ASSISTANT",
        content:
          "The Zephyr release palette decision used violet for the primary state.",
        status: "COMPLETE",
      },
    });

    const note = await prisma.workspaceObject.create({
      data: {
        kind: "NOTE",
        personalOwnerUserId: actorUserId,
        createdByUserId: actorUserId,
        note: {
          create: {
            title: "Zephyr release checklist",
            contentMarkdown:
              "Violet rollout checklist with the final release gate.",
          },
        },
      },
    });

    const project = await prisma.project.create({
      data: {
        ownerUserId: actorUserId,
        name: "Zephyr Release",
        description: "Violet rollout and release checklist",
      },
    });

    const sourceMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content:
          "What did we decide about the Zephyr violet release checklist?",
        status: "COMPLETE",
      },
    });
    const planId = randomUUID();
    await prisma.executionPlan.create({
      data: {
        id: planId,
        messageId: sourceMessage.id,
        userId: actorUserId,
        conversationId: conversation.id,
        schemaVersion: 1,
        version: 1,
        planHash: "planning:pending:v1",
        goal: "Retrieve relevant context",
        status: "PLANNING",
        maxParallelism: 1,
      },
    });

    const snapshot = await snapshots.createForExecutionPlan({
      actorUserId,
      planId,
    });

    const olderItem = snapshot.items.find(
      (item) => item.sourceId === older.id,
    );
    const crossItem = snapshot.items.find(
      (item) => item.sourceId === crossConversation.id,
    );
    const noteItem = snapshot.items.find(
      (item) => item.sourceId === note.id,
    );
    const projectItem = snapshot.items.find(
      (item) => item.sourceId === project.id,
    );

    expect(olderItem?.sourceType).toBe("MESSAGE");
    expect(retrievalKind(olderItem?.metadata)).toBe("OLDER_HISTORY");
    expect(crossItem?.sourceType).toBe("MESSAGE");
    expect(retrievalKind(crossItem?.metadata)).toBe(
      "CROSS_CONVERSATION",
    );
    expect(noteItem?.sourceType).toBe("WORKSPACE_OBJECT");
    expect(retrievalKind(noteItem?.metadata)).toBe("FILE_METADATA");
    expect(projectItem?.sourceType).toBe("PROJECT");
    expect(retrievalKind(projectItem?.metadata)).toBe(
      "PROJECT_OBJECT",
    );

    const l1Items = snapshot.items.filter(
      (item) => retrievalKind(item.metadata) === "L1_RAW",
    );
    expect(l1Items).toHaveLength(24);
    expect(l1Items.some((item) => item.sourceId === older.id)).toBe(
      false,
    );
  });

  it("retrieves immutable inline content for a relevant prior artifact", async () => {
    const actorUserId = await createUser(
      prisma,
      "retrieval-artifact-content",
    );
    const originConversation = await prisma.conversation.create({
      data: {
        userId: actorUserId,
        title: "Artifact origin",
      },
    });
    const originMessage = await prisma.message.create({
      data: {
        conversationId: originConversation.id,
        role: "USER",
        content: "Create the Zephyr release plan artifact",
        status: "COMPLETE",
      },
    });
    const originPlanId = randomUUID();
    const originInvocationId = randomUUID();
    await prisma.executionPlan.create({
      data: {
        id: originPlanId,
        messageId: originMessage.id,
        userId: actorUserId,
        conversationId: originConversation.id,
        schemaVersion: 1,
        version: 1,
        planHash: "sha256:" + randomUUID(),
        goal: "Create release artifact",
        status: "COMPLETED",
        maxParallelism: 1,
        invocations: {
          create: {
            id: originInvocationId,
            sequence: 0,
            purpose: "Create Zephyr release plan",
            targetKind: "VIMLA",
            outputDeclarations: [
              {
                name: "release-plan",
                artifactType: "TEXT",
              },
            ],
            acceptanceCriteria: [],
            riskClass: "READ_ONLY",
            approvalPolicy: "AUTO",
            failurePolicy: "FAIL_PLAN",
            joinPolicy: "ALL_REQUIRED",
            status: "COMPLETED",
          },
        },
      },
    });
    const artifacts = new ArtifactService(prisma);
    const artifact = await artifacts.createArtifact({
      actorUserId,
      creatorInvocationId: originInvocationId,
      outputName: "release-plan",
      type: "TEXT",
      classification: "PRIVATE",
      metadata: {
        topic: "Zephyr release",
      },
      content: {
        kind: "INLINE_JSON",
        value: {
          text: "The immutable Zephyr release decision is violet.",
        },
      },
    });

    const currentConversation = await prisma.conversation.create({
      data: {
        userId: actorUserId,
        title: "Artifact retrieval",
      },
    });
    const sourceMessage = await prisma.message.create({
      data: {
        conversationId: currentConversation.id,
        role: "USER",
        content: "What did the Zephyr release-plan artifact say?",
        status: "COMPLETE",
      },
    });
    const planId = randomUUID();
    await prisma.executionPlan.create({
      data: {
        id: planId,
        messageId: sourceMessage.id,
        userId: actorUserId,
        conversationId: currentConversation.id,
        schemaVersion: 1,
        version: 1,
        planHash: "planning:pending:v1",
        goal: "Retrieve prior artifact content",
        status: "PLANNING",
        maxParallelism: 1,
      },
    });

    const snapshot = await snapshots.createForExecutionPlan({
      actorUserId,
      planId,
    });
    const artifactItem = snapshot.items.find(
      (item) => item.sourceId === artifact.artifactId,
    );
    const artifactMetadata = record(artifactItem?.metadata);

    expect(artifactItem?.sourceType).toBe("ARTIFACT");
    expect(retrievalKind(artifactItem?.metadata)).toBe("ARTIFACT");
    expect(artifactMetadata?.contentKind).toBe("INLINE_JSON");
    expect(artifactMetadata?.inlineContentJson).toContain(
      "immutable Zephyr release decision is violet",
    );
    expect(artifactItem?.sourceVersion).toBe("1");

    await artifacts.createVersion({
      actorUserId,
      artifactId: artifact.artifactId,
      expectedCurrentVersion: artifact.version,
      content: {
        kind: "INLINE_JSON",
        value: {
          text: "A newer artifact version says orange.",
        },
      },
    });
    const replay = await snapshots.createForExecutionPlan({
      actorUserId,
      planId,
    });
    const replayArtifact = replay.items.find(
      (item) => item.sourceId === artifact.artifactId,
    );
    const replayMetadata = record(replayArtifact?.metadata);
    expect(replayArtifact?.sourceVersion).toBe("1");
    expect(replayMetadata?.inlineContentJson).toContain(
      "immutable Zephyr release decision is violet",
    );
    expect(replayMetadata?.inlineContentJson).not.toContain(
      "newer artifact version says orange",
    );
  });

  it("derives raw-history pressure from the whole conversation rather than the scan window", async () => {
    const actorUserId = await createUser(
      prisma,
      "retrieval-history-budget",
    );
    const conversation = await prisma.conversation.create({
      data: {
        userId: actorUserId,
        title: "Long history",
      },
    });

    for (let index = 0; index < 6; index += 1) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: index % 2 === 0 ? "USER" : "ASSISTANT",
          content: "x".repeat(40),
          status: "COMPLETE",
        },
      });
    }

    const sourceMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: "continue",
        status: "COMPLETE",
      },
    });
    const planId = randomUUID();
    await prisma.executionPlan.create({
      data: {
        id: planId,
        messageId: sourceMessage.id,
        userId: actorUserId,
        conversationId: conversation.id,
        schemaVersion: 1,
        version: 1,
        planHash: "planning:pending:v1",
        goal: "Measure full raw history",
        status: "PLANNING",
        maxParallelism: 1,
      },
    });

    const retrieval = new ContextRetrievalService(prisma, [], {
      l1RawLimit: 1,
      olderHistoryScanLimit: 1,
    });
    const scopedSnapshots = new ContextSnapshotService(
      prisma,
      undefined,
      retrieval,
    );
    const snapshot = await scopedSnapshots.createForExecutionPlan({
      actorUserId,
      planId,
    });
    const conversationItem = snapshot.items.find(
      (item) => item.sourceType === "CONVERSATION",
    );

    expect(rawHistoryTokens(conversationItem?.metadata)).toBe(240);
  });

  it("rejects provider attempts to override raw source-of-truth context", async () => {
    const actorUserId = await createUser(
      prisma,
      "retrieval-provider-integrity",
    );
    const conversation = await prisma.conversation.create({
      data: {
        userId: actorUserId,
        title: "Provider integrity",
      },
    });
    const sourceMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: "Use the real source message",
        status: "COMPLETE",
      },
    });
    const planId = randomUUID();
    await prisma.executionPlan.create({
      data: {
        id: planId,
        messageId: sourceMessage.id,
        userId: actorUserId,
        conversationId: conversation.id,
        schemaVersion: 1,
        version: 1,
        planHash: "planning:pending:v1",
        goal: "Reject source spoofing",
        status: "PLANNING",
        maxParallelism: 1,
      },
    });

    const retrieval = new ContextRetrievalService(prisma, [
      {
        retrieve: () =>
          Promise.resolve([
            {
              item: {
                sourceType: "USER_MESSAGE" as const,
                sourceId: sourceMessage.id,
                sourceVersion: "spoofed",
                classification: "PRIVATE" as const,
                metadata: {
                  content: "provider-controlled replacement",
                },
              },
              sourceKind: "IMMEDIATE" as const,
              sourceScope: {
                kind: "PERSONAL" as const,
                ownerUserId: actorUserId,
              },
              reason: "attempted source override",
              lexicalScore: 1,
              directReference: true,
              currentSurface: true,
              currentProject: false,
              authority: "AUTHORITATIVE" as const,
              occurredAt: null,
              estimatedTokens: 8,
            },
          ]),
      },
    ]);

    await expect(
      retrieval.retrieveForExecutionPlan({
        actorUserId,
        planId,
      }),
    ).rejects.toBeInstanceOf(ContextValidationError);
  });

  it("normalizes derived provider provenance and rejects authority escalation", async () => {
    const actorUserId = await createUser(
      prisma,
      "retrieval-provider-normalization",
    );
    const conversation = await prisma.conversation.create({
      data: {
        userId: actorUserId,
        title: "Provider normalization",
      },
    });
    const sourceMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: "Recall the Zephyr release preference",
        status: "COMPLETE",
      },
    });
    const planId = randomUUID();
    await prisma.executionPlan.create({
      data: {
        id: planId,
        messageId: sourceMessage.id,
        userId: actorUserId,
        conversationId: conversation.id,
        schemaVersion: 1,
        version: 1,
        planHash: "planning:pending:v1",
        goal: "Normalize derived provider context",
        status: "PLANNING",
        maxParallelism: 1,
      },
    });

    const retrieval = new ContextRetrievalService(prisma, [
      {
        retrieve: () =>
          Promise.resolve([
            {
              item: {
                sourceType: "MEMORY" as const,
                sourceId: "memory-zephyr",
                sourceVersion: "v1",
                classification: "PRIVATE" as const,
                metadata: {
                  fact: "Zephyr release preference is violet.",
                  retrieval: {
                    authority: "AUTHORITATIVE",
                    scope: { kind: "PROJECT", projectId: "spoofed" },
                  },
                },
              },
              sourceKind: "PERSONAL_MEMORY" as const,
              sourceScope: {
                kind: "PERSONAL" as const,
                ownerUserId: actorUserId,
              },
              reason: "durable personal memory match",
              lexicalScore: 0.8,
              directReference: false,
              currentSurface: false,
              currentProject: false,
              authority: "DERIVED" as const,
              occurredAt: "2026-09-20T00:00:00.000Z",
              estimatedTokens: 1,
              rawHistoryTokens: 999_999,
            },
          ]),
      },
    ]);
    const result = await retrieval.retrieveForExecutionPlan({
      actorUserId,
      planId,
    });
    const memory = result.candidates.find(
      (candidate) => candidate.item.sourceType === "MEMORY",
    );
    expect(memory?.authority).toBe("DERIVED");
    const metadata = record(memory?.item.metadata);
    const provenance = record(metadata?.retrieval);
    expect(provenance).toMatchObject({
      sourceKind: "PERSONAL_MEMORY",
      authority: "DERIVED",
      reason: "durable personal memory match",
      scope: {
        kind: "PERSONAL",
        ownerUserId: actorUserId,
      },
    });
    expect(provenance?.estimatedTokens).not.toBe(1);
    expect(provenance?.rawHistoryTokens).toBeUndefined();

    const escalating = new ContextRetrievalService(prisma, [
      {
        retrieve: () =>
          Promise.resolve([
            {
              item: {
                sourceType: "MEMORY" as const,
                sourceId: "memory-escalating",
                sourceVersion: "v1",
                classification: "PRIVATE" as const,
                metadata: { fact: "provider controlled" },
              },
              sourceKind: "PERSONAL_MEMORY" as const,
              sourceScope: {
                kind: "PERSONAL" as const,
                ownerUserId: actorUserId,
              },
              reason: "invalid authority",
              lexicalScore: 1,
              directReference: true,
              currentSurface: true,
              currentProject: false,
              authority: "AUTHORITATIVE" as const,
              occurredAt: null,
              estimatedTokens: 8,
            },
          ]),
      },
    ]);

    await expect(
      escalating.retrieveForExecutionPlan({
        actorUserId,
        planId,
      }),
    ).rejects.toBeInstanceOf(ContextValidationError);
  });

  it("does not pull unrelated messages from another personal conversation", async () => {
    const actorUserId = await createUser(
      prisma,
      "retrieval-isolation",
    );
    const current = await prisma.conversation.create({
      data: { userId: actorUserId, title: "Current" },
    });
    const unrelated = await prisma.conversation.create({
      data: { userId: actorUserId, title: "Unrelated" },
    });
    const unrelatedMessage = await prisma.message.create({
      data: {
        conversationId: unrelated.id,
        role: "USER",
        content:
          "Cooking pasta with tomatoes and basil tonight.",
        status: "COMPLETE",
      },
    });
    const sourceMessage = await prisma.message.create({
      data: {
        conversationId: current.id,
        role: "USER",
        content:
          "Find the Zephyr release architecture decision.",
        status: "COMPLETE",
      },
    });
    const planId = randomUUID();
    await prisma.executionPlan.create({
      data: {
        id: planId,
        messageId: sourceMessage.id,
        userId: actorUserId,
        conversationId: current.id,
        schemaVersion: 1,
        version: 1,
        planHash: "planning:pending:v1",
        goal: "Avoid irrelevant retrieval",
        status: "PLANNING",
        maxParallelism: 1,
      },
    });

    const snapshot = await snapshots.createForExecutionPlan({
      actorUserId,
      planId,
    });

    expect(
      snapshot.items.some(
        (item) => item.sourceId === unrelatedMessage.id,
      ),
    ).toBe(false);
  });
});

async function createUser(
  prisma: PrismaClient,
  prefix: string,
): Promise<string> {
  const suffix = randomUUID();
  const id = prefix + "-" + suffix;
  await prisma.user.create({
    data: {
      id,
      name: "Context Retrieval User",
      email: suffix + "@context-retrieval.test",
      emailVerified: true,
    },
  });
  return id;
}

function retrievalKind(metadata: unknown): string | null {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    return null;
  }
  const retrieval = (metadata as Record<string, unknown>).retrieval;
  if (
    typeof retrieval !== "object" ||
    retrieval === null ||
    Array.isArray(retrieval)
  ) {
    return null;
  }
  const value = (retrieval as Record<string, unknown>).sourceKind;
  return typeof value === "string" ? value : null;
}

function rawHistoryTokens(metadata: unknown): number | null {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    return null;
  }
  const retrieval = (metadata as Record<string, unknown>).retrieval;
  if (
    typeof retrieval !== "object" ||
    retrieval === null ||
    Array.isArray(retrieval)
  ) {
    return null;
  }
  const value = (retrieval as Record<string, unknown>).rawHistoryTokens;
  return typeof value === "number" ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
