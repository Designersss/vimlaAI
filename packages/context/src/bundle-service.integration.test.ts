import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArtifactService } from "@vimla/artifacts";
import { createPrismaClient, type PrismaClient } from "@vimla/database";
import {
  ContextAccessDeniedError,
  ContextBundleService,
  ContextSnapshotService,
  ContextValidationError,
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

    const firstInvocationId = invocationIds[0];
    const secondInvocationId = invocationIds[1];
    if (!firstInvocationId || !secondInvocationId) {
      throw new Error("Expected two context-policy test invocations");
    }

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
      invocationId: firstInvocationId,
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
        invocationId: secondInvocationId,
      }),
    ).rejects.toBeInstanceOf(ContextAccessDeniedError);

    const blocked = await prisma.contextBundle.findUnique({
      where: { invocationId: secondInvocationId },
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
        invocationId: firstInvocationId,
      }),
    ).rejects.toBeInstanceOf(ContextAccessDeniedError);
  });

  it("keeps project-focused conversations PERSONAL while restricting cross-chat retrieval to the focused project", async () => {
    const actorUserId = await createUser(
      prisma,
      "project-surface-actor",
    );
    const project = await prisma.project.create({
      data: {
        ownerUserId: actorUserId,
        name: "Zephyr Project",
        members: {
          create: {
            userId: actorUserId,
            role: "OWNER",
          },
        },
      },
    });

    const relatedConversation =
      await prisma.conversation.create({
        data: {
          userId: actorUserId,
          projectId: project.id,
          title: "Earlier Zephyr project chat",
        },
      });
    const relatedMessage = await prisma.message.create({
      data: {
        conversationId: relatedConversation.id,
        role: "ASSISTANT",
        content:
          "Zephyr launch architecture uses the violet rollout gate.",
        status: "COMPLETE",
      },
    });

    const privateConversation =
      await prisma.conversation.create({
        data: {
          userId: actorUserId,
          title: "Private unrelated chat",
        },
      });
    const privateMessage = await prisma.message.create({
      data: {
        conversationId: privateConversation.id,
        role: "ASSISTANT",
        content:
          "Zephyr launch architecture private note uses a violet rollout gate.",
        status: "COMPLETE",
      },
    });

    const currentConversation =
      await prisma.conversation.create({
        data: {
          userId: actorUserId,
          projectId: project.id,
          title: "Current Zephyr project chat",
        },
      });
    const sourceMessage = await prisma.message.create({
      data: {
        conversationId: currentConversation.id,
        role: "USER",
        content:
          "What is the Zephyr launch architecture violet rollout gate?",
        status: "COMPLETE",
      },
    });
    const { planId, invocationIds } = await createPlan(
      prisma,
      actorUserId,
      currentConversation.id,
      sourceMessage.id,
      1,
    );
    const invocationId = invocationIds[0];
    if (!invocationId) {
      throw new Error("Expected project context invocation");
    }

    const snapshot = await snapshots.createForExecutionPlan({
      actorUserId,
      planId,
    });
    const audience = snapshot.items.find(
      (item) => item.sourceType === "AUDIENCE",
    );
    expect(audience?.sourceId).toBe(
      currentConversation.id,
    );
    expect(audience?.metadata).toMatchObject({
      kind: "PERSONAL",
      participantUserIds: [actorUserId],
      focusedProjectId: project.id,
    });

    const related = snapshot.items.find(
      (item) => item.sourceId === relatedMessage.id,
    );
    const privateItem = snapshot.items.find(
      (item) => item.sourceId === privateMessage.id,
    );
    expect(related).toBeDefined();
    // Cross-chat retrieval remains project-focused even though the response
    // surface itself stays PERSONAL.
    expect(privateItem).toBeUndefined();

    const resolved = await bundles.resolveForInvocation({
      actorUserId,
      invocationId,
    });
    expect(resolved.manifest.surfaceKind).toBe("PERSONAL");
    expect(
      resolved.items.some(
        (item) => item.sourceId === relatedMessage.id,
      ),
    ).toBe(true);
    expect(
      resolved.items.some(
        (item) => item.sourceId === privateMessage.id,
      ),
    ).toBe(false);
  });

  it("rejects a shared audience descriptor whose source does not match its surface id", async () => {
    const actorUserId = await createUser(prisma, "audience-source-actor");
    const peerUserId = await createUser(prisma, "audience-source-peer");
    const personalConversation = await prisma.conversation.create({
      data: { userId: actorUserId, title: "Audience source integrity" },
    });
    const sourceMessage = await prisma.message.create({
      data: {
        conversationId: personalConversation.id,
        role: "USER",
        content: "Use shared context",
        status: "COMPLETE",
      },
    });
    const { planId, invocationIds } = await createPlan(
      prisma,
      actorUserId,
      personalConversation.id,
      sourceMessage.id,
      1,
    );
    const invocationId = invocationIds[0];
    if (!invocationId) {
      throw new Error("Expected one audience-integrity invocation");
    }

    const directConversation = await prisma.directConversation.create({
      data: {
        pairKey: `audience-source:${randomUUID()}`,
        members: {
          create: [
            { userId: actorUserId },
            { userId: peerUserId },
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
          sourceId: personalConversation.id,
          classification: "PRIVATE",
          metadata: {
            kind: "DIRECT_CHAT",
            directConversationId: directConversation.id,
            participantUserIds: [actorUserId, peerUserId],
          },
        },
      ],
    });

    await expect(
      bundles.resolveForInvocation({
        actorUserId,
        invocationId,
      }),
    ).rejects.toBeInstanceOf(ContextValidationError);
  });

  it("includes only audience-readable dependency artifacts and re-checks grants between invocations", async () => {
    const actorUserId = await createUser(prisma, "artifact-policy-actor");
    const peerUserId = await createUser(prisma, "artifact-policy-peer");
    const conversation = await prisma.conversation.create({
      data: {
        userId: actorUserId,
        title: "Artifact policy origin",
      },
    });
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: "Use the workflow artifact",
        status: "COMPLETE",
      },
    });
    const directConversation = await prisma.directConversation.create({
      data: {
        pairKey: `artifact-policy:${randomUUID()}`,
        members: {
          create: [
            { userId: actorUserId },
            { userId: peerUserId },
          ],
        },
      },
    });

    const planId = randomUUID();
    const sourceInvocationId = randomUUID();
    const firstTargetId = randomUUID();
    const secondTargetId = randomUUID();
    await prisma.executionPlan.create({
      data: {
        id: planId,
        messageId: message.id,
        userId: actorUserId,
        conversationId: conversation.id,
        schemaVersion: 1,
        version: 1,
        planHash: `sha256:${randomUUID()}`,
        goal: "Artifact audience policy test",
        status: "PLANNED",
        maxParallelism: 2,
        invocations: {
          create: [
            {
              id: sourceInvocationId,
              sequence: 0,
              purpose: "Produce candidate",
              targetKind: "VIMLA",
              outputDeclarations: [
                { name: "result", artifactType: "TEXT" },
              ],
              acceptanceCriteria: [],
              riskClass: "READ_ONLY",
              approvalPolicy: "AUTO",
              failurePolicy: "FAIL_PLAN",
              joinPolicy: "ALL_REQUIRED",
              status: "COMPLETED",
            },
            {
              id: firstTargetId,
              sequence: 1,
              purpose: "Consume candidate once",
              targetKind: "AI_MODEL",
              targetModelSlug: "gpt-5-6-luna",
              outputDeclarations: [],
              acceptanceCriteria: [],
              riskClass: "READ_ONLY",
              approvalPolicy: "AUTO",
              failurePolicy: "FAIL_PLAN",
              joinPolicy: "ALL_REQUIRED",
              status: "PENDING",
            },
            {
              id: secondTargetId,
              sequence: 2,
              purpose: "Consume candidate after ACL change",
              targetKind: "AI_MODEL",
              targetModelSlug: "gpt-5-6-luna",
              outputDeclarations: [],
              acceptanceCriteria: [],
              riskClass: "READ_ONLY",
              approvalPolicy: "AUTO",
              failurePolicy: "FAIL_PLAN",
              joinPolicy: "ALL_REQUIRED",
              status: "PENDING",
            },
          ],
        },
      },
    });
    for (const targetId of [firstTargetId, secondTargetId]) {
      await prisma.invocationDependency.create({
        data: {
          id: randomUUID(),
          planId,
          fromInvocationId: sourceInvocationId,
          toInvocationId: targetId,
          conditionKind: "DATA",
          conditionOutcome: "",
          inputBindings: [
            {
              inputName: "candidate",
              sourceOutputName: "result",
              expectedArtifactType: "TEXT",
            },
          ],
        },
      });
    }

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
      ],
    });

    const artifactService = new ArtifactService(prisma);
    const artifact = await artifactService.createArtifact({
      actorUserId,
      creatorInvocationId: sourceInvocationId,
      outputName: "result",
      type: "TEXT",
      classification: "PRIVATE",
      content: {
        kind: "INLINE_JSON",
        value: { text: "audience-safe workflow result" },
      },
    });
    await artifactService.grantReadAccess({
      actorUserId,
      artifactId: artifact.artifactId,
      granteeUserId: peerUserId,
    });

    const first = await bundles.resolveForInvocation({
      actorUserId,
      invocationId: firstTargetId,
    });
    expect(first.artifacts).toHaveLength(1);
    expect(first.artifacts[0]?.reference.artifactVersionId).toBe(
      artifact.artifactVersionId,
    );
    expect(first.manifest.allowedArtifacts).toEqual([
      expect.objectContaining({
        inputName: "candidate",
        artifactId: artifact.artifactId,
        artifactVersionId: artifact.artifactVersionId,
        classification: "PRIVATE",
        fingerprint: artifact.fingerprint,
      }),
    ]);

    await artifactService.revokeReadAccess({
      actorUserId,
      artifactId: artifact.artifactId,
      granteeUserId: peerUserId,
    });

    await expect(
      bundles.resolveForInvocation({
        actorUserId,
        invocationId: secondTargetId,
      }),
    ).rejects.toBeInstanceOf(ContextAccessDeniedError);

    const blocked = await prisma.contextBundle.findUniqueOrThrow({
      where: { invocationId: secondTargetId },
    });
    const blockedManifest = blocked.manifest as {
      artifactDenials?: Array<{
        artifactRefHash?: string;
        reason?: string;
      }>;
    };
    expect(blockedManifest.artifactDenials).toEqual([
      expect.objectContaining({
        artifactRefHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        reason: "AUDIENCE_ACCESS_DENIED",
      }),
    ]);
    const serialized = JSON.stringify(blocked.manifest);
    expect(serialized).not.toContain(artifact.artifactId);
    expect(serialized).not.toContain(artifact.artifactVersionId);
    expect(serialized).not.toContain(peerUserId);
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
