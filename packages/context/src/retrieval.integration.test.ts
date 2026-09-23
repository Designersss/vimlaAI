import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@vimla/database";
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
