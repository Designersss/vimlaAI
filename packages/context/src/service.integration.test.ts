import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@vimla/database";
import {
  ContextAccessDeniedError,
  ContextConflictError,
  ContextSnapshotService,
} from "./index.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

describe("ContextSnapshotService", () => {
  let prisma: PrismaClient;
  let service: ContextSnapshotService;

  beforeAll(() => {
    prisma = createPrismaClient(testDatabaseUrl);
    service = new ContextSnapshotService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("freezes execution-plan context and never changes it when source records mutate", async () => {
    const actorUserId = await createUser(prisma, "context-freeze");
    await prisma.userPreference.create({
      data: {
        userId: actorUserId,
        locale: "ru",
        timezone: "Europe/Moscow",
      },
    });

    const conversation = await prisma.conversation.create({
      data: { userId: actorUserId, title: "Frozen conversation" },
    });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: "Earlier allowed message",
        status: "COMPLETE",
      },
    });
    const sourceMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: "Original user request",
        status: "COMPLETE",
      },
    });
    const workspaceObject = await prisma.workspaceObject.create({
      data: {
        kind: "NOTE",
        personalOwnerUserId: actorUserId,
        createdByUserId: actorUserId,
        sourceConversationId: conversation.id,
        sourceMessageId: sourceMessage.id,
        note: {
          create: { title: "Frozen note", contentMarkdown: "initial" },
        },
      },
    });
    const { planId } = await createPlan(prisma, actorUserId, conversation.id, sourceMessage.id);

    const snapshot = await service.createForExecutionPlan({ actorUserId, planId });
    expect(snapshot.version).toBe(1);
    expect(snapshot.items.map((item) => item.sourceType)).toEqual(
      expect.arrayContaining([
        "USER_MESSAGE",
        "CONVERSATION",
        "MESSAGE",
        "PARTICIPANT",
        "LOCALE_TIMEZONE",
        "AUDIENCE",
        "WORKSPACE_OBJECT",
      ]),
    );
    const frozenMessage = snapshot.items.find((item) => item.sourceType === "USER_MESSAGE");
    expect(frozenMessage?.metadata).toMatchObject({ content: "Original user request" });

    await prisma.message.update({
      where: { id: sourceMessage.id },
      data: { content: "Changed after snapshot" },
    });
    await prisma.userPreference.update({
      where: { userId: actorUserId },
      data: { timezone: "America/Toronto" },
    });
    await prisma.workspaceObject.update({
      where: { id: workspaceObject.id },
      data: { archivedAt: new Date() },
    });

    const replay = await service.createForExecutionPlan({ actorUserId, planId });
    expect(replay).toEqual(snapshot);
    expect(replay.id).toBe(snapshot.id);
    expect(replay.version).toBe(1);
    expect(replay.fingerprint).toBe(snapshot.fingerprint);
    expect(replay.items.find((item) => item.sourceType === "USER_MESSAGE")?.metadata).toMatchObject({
      content: "Original user request",
    });
  });

  it("freezes context on a durable PLANNING shell before semantic planning starts", async () => {
    const actorUserId = await createUser(prisma, "context-planning-shell");
    const conversation = await prisma.conversation.create({
      data: { userId: actorUserId, title: "Planning shell" },
    });
    const sourceMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: "Continue the API approach from earlier",
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
        goal: "Planning workflow",
        status: "PLANNING",
        maxParallelism: 1,
      },
    });

    const snapshot = await service.createForExecutionPlan({
      actorUserId,
      planId,
    });
    expect(snapshot.planId).toBe(planId);
    expect(
      snapshot.items.find((item) => item.sourceType === "USER_MESSAGE")?.metadata,
    ).toMatchObject({ content: "Continue the API approach from earlier" });

    await prisma.message.update({
      where: { id: sourceMessage.id },
      data: { content: "Changed after planning started" },
    });
    const replay = await service.createForExecutionPlan({
      actorUserId,
      planId,
    });
    expect(replay.fingerprint).toBe(snapshot.fingerprint);
    expect(
      replay.items.find((item) => item.sourceType === "USER_MESSAGE")?.metadata,
    ).toMatchObject({ content: "Continue the API approach from earlier" });
  });

  it("rejects conflicting explicit replay and re-checks protected access at invocation time", async () => {
    const actorUserId = await createUser(prisma, "context-member");
    const projectOwnerUserId = await createUser(prisma, "context-owner");
    const conversation = await prisma.conversation.create({
      data: { userId: actorUserId, title: "Project context" },
    });
    const sourceMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: "Use the project context",
        status: "COMPLETE",
      },
    });
    const { planId, invocationId } = await createPlan(
      prisma,
      actorUserId,
      conversation.id,
      sourceMessage.id,
    );
    const project = await prisma.project.create({
      data: {
        ownerUserId: projectOwnerUserId,
        name: "Shared project",
        members: {
          create: { userId: actorUserId, role: "MEMBER" },
        },
      },
    });

    const projectItem = {
      sourceType: "PROJECT" as const,
      sourceId: project.id,
      sourceVersion: project.updatedAt.toISOString(),
      classification: "PRIVATE" as const,
      contentRef: `vimla://projects/${project.id}`,
      metadata: { name: project.name },
    };
    const snapshot = await service.create({
      actorUserId,
      planId,
      items: [projectItem],
    });

    await expect(
      service.create({
        actorUserId,
        planId,
        items: [{ ...projectItem, sourceVersion: "different-version" }],
      }),
    ).rejects.toBeInstanceOf(ContextConflictError);

    await expect(
      service.resolveForPlan(actorUserId, planId),
    ).resolves.toEqual(snapshot);
    await expect(
      service.resolveForInvocation({ actorUserId, invocationId }),
    ).resolves.toEqual(snapshot);

    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId: project.id, userId: actorUserId } },
    });

    await expect(
      service.resolveForPlan(actorUserId, planId),
    ).rejects.toBeInstanceOf(ContextAccessDeniedError);
    await expect(
      service.resolveForInvocation({ actorUserId, invocationId }),
    ).rejects.toBeInstanceOf(ContextAccessDeniedError);
    const retained = await service.getByPlan(actorUserId, planId);
    expect(retained.id).toBe(snapshot.id);
    expect(retained.fingerprint).toBe(snapshot.fingerprint);
  });
});

async function createUser(prisma: PrismaClient, prefix: string): Promise<string> {
  const suffix = randomUUID();
  const id = `${prefix}-${suffix}`;
  await prisma.user.create({
    data: {
      id,
      name: "Context Test User",
      email: `${suffix}@context.test`,
      emailVerified: true,
    },
  });
  return id;
}

async function createPlan(
  prisma: PrismaClient,
  userId: string,
  conversationId: string,
  messageId: string,
): Promise<{ planId: string; invocationId: string }> {
  const planId = randomUUID();
  const invocationId = randomUUID();
  await prisma.executionPlan.create({
    data: {
      id: planId,
      messageId,
      userId,
      conversationId,
      schemaVersion: 1,
      version: 1,
      planHash: `sha256:${randomUUID()}`,
      goal: "Context test plan",
      status: "PLANNED",
      maxParallelism: 1,
      invocations: {
        create: {
          id: invocationId,
          sequence: 0,
          purpose: "Read frozen context",
          targetKind: "VIMLA",
          outputDeclarations: [],
          acceptanceCriteria: [],
          riskClass: "READ_ONLY",
          approvalPolicy: "AUTO",
          failurePolicy: "FAIL_PLAN",
          joinPolicy: "ALL_REQUIRED",
          status: "PENDING",
        },
      },
    },
  });
  return { planId, invocationId };
}
