import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@vimla/database";
import {
  ContextAccessDeniedError,
  ContextBundleService,
  ContextSnapshotService,
} from "./index.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

describe("ContextBundleService", () => {
  let prisma: PrismaClient;
  let snapshots: ContextSnapshotService;
  let bundles: ContextBundleService;

  beforeAll(() => {
    prisma = createPrismaClient(testDatabaseUrl);
    snapshots = new ContextSnapshotService(prisma);
    bundles = new ContextBundleService(prisma, snapshots);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("filters private personal context from a Direct Chat and blocks project context after audience access is revoked", async () => {
    const actorUserId = await createUser(prisma, "context-policy-actor");
    const peerUserId = await createUser(prisma, "context-policy-peer");

    const personalConversation = await prisma.conversation.create({
      data: {
        userId: actorUserId,
        title: "Private workflow origin",
      },
    });
    const sourceMessage = await prisma.message.create({
      data: {
        conversationId: personalConversation.id,
        role: "USER",
        content: "Use shared Project X context in this shared response",
        status: "COMPLETE",
      },
    });

    const { planId, invocationIds } = await createPlan(
      prisma,
      actorUserId,
      personalConversation.id,
      sourceMessage.id,
      2,
    );

    const directConversation = await prisma.directConversation.create({
      data: {
        pairKey: `context-policy:${randomUUID()}`,
        members: {
          create: [
            { userId: actorUserId },
            { userId: peerUserId },
          ],
        },
      },
    });

    const project = await prisma.project.create({
      data: {
        ownerUserId: actorUserId,
        name: "Project X",
        members: {
          create: [
            { userId: actorUserId, role: "OWNER" },
            { userId: peerUserId, role: "MEMBER" },
          ],
        },
      },
    });

    await snapshots.create({
      actorUserId,
      planId,
      items: [
        {
          sourceType: "AUDIENCE",
          sourceId: directConversation.id,
          classification: "PRIVATE",
          metadata: {
            kind: "DIRECT_CHAT",
            directConversationId: directConversation.id,
            participantUserIds: [actorUserId, peerUserId],
          },
        },
        {
          sourceType: "PROJECT",
          sourceId: project.id,
          sourceVersion: project.updatedAt.toISOString(),
          classification: "PRIVATE",
          contentRef: `vimla://projects/${project.id}`,
          metadata: { name: project.name },
        },
        {
          sourceType: "PARTICIPANT",
          sourceId: actorUserId,
          classification: "PRIVATE",
          metadata: {
            name: "Private actor profile",
            privateFact: "must never enter a shared bundle",
          },
        },
      ],
    });

    const first = await bundles.resolveForInvocation({
      actorUserId,
      invocationId: invocationIds[0]!,
    });

    expect(first.items.map((item) => item.sourceType)).toEqual(["PROJECT"]);
    expect(first.manifest.denials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "PARTICIPANT",
          reason: "SOURCE_SCOPE_DENIED",
        }),
      ]),
    );

    const serializedFirstManifest = JSON.stringify(first.manifest);
    expect(serializedFirstManifest).not.toContain(actorUserId);
    expect(serializedFirstManifest).not.toContain(peerUserId);
    expect(serializedFirstManifest).not.toContain("Private actor profile");
    expect(serializedFirstManifest).not.toContain("must never enter a shared bundle");

    await prisma.projectMember.delete({
      where: {
        projectId_userId: {
          projectId: project.id,
          userId: peerUserId,
        },
      },
    });

    await expect(
      bundles.resolveForInvocation({
        actorUserId,
        invocationId: invocationIds[1]!,
      }),
    ).rejects.toBeInstanceOf(ContextAccessDeniedError);

    const blocked = await prisma.contextBundle.findUnique({
      where: { invocationId: invocationIds[1]! },
    });
    expect(blocked).not.toBeNull();
    const blockedManifest = blocked?.manifest as {
      denials?: Array<{
        sourceType?: string;
        reason?: string;
        sourceRefHash?: string;
      }>;
    };
    expect(blockedManifest.denials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "PROJECT",
          reason: "AUDIENCE_ACCESS_DENIED",
          sourceRefHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        }),
      ]),
    );
    const serializedBlockedManifest = JSON.stringify(blocked?.manifest);
    expect(serializedBlockedManifest).not.toContain(project.id);
    expect(serializedBlockedManifest).not.toContain(actorUserId);
    expect(serializedBlockedManifest).not.toContain(peerUserId);

    await expect(
      bundles.resolveForInvocation({
        actorUserId,
        invocationId: invocationIds[0]!,
      }),
    ).rejects.toBeInstanceOf(ContextAccessDeniedError);
  });
});

async function createUser(
  prisma: PrismaClient,
  prefix: string,
): Promise<string> {
  const suffix = randomUUID();
  const id = `${prefix}-${suffix}`;
  await prisma.user.create({
    data: {
      id,
      name: "Context Policy Test User",
      email: `${suffix}@context-policy.test`,
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
  invocationCount: number,
): Promise<{ planId: string; invocationIds: string[] }> {
  const planId = randomUUID();
  const invocationIds = Array.from(
    { length: invocationCount },
    () => randomUUID(),
  );

  await prisma.executionPlan.create({
    data: {
      id: planId,
      messageId,
      userId,
      conversationId,
      schemaVersion: 1,
      version: 1,
      planHash: `sha256:${randomUUID()}`,
      goal: "Context policy integration test",
      status: "PLANNED",
      maxParallelism: invocationCount,
      invocations: {
        create: invocationIds.map((id, sequence) => ({
          id,
          sequence,
          purpose: `Read audience-safe context ${sequence}`,
          targetKind: "VIMLA",
          outputDeclarations: [],
          acceptanceCriteria: [],
          riskClass: "READ_ONLY",
          approvalPolicy: "AUTO",
          failurePolicy: "FAIL_PLAN",
          joinPolicy: "ALL_REQUIRED",
          status: "PENDING",
        })),
      },
    },
  });

  return { planId, invocationIds };
}
