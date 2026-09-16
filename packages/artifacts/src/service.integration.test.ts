import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@vimla/database";
import {
  ArtifactBindingError,
  ArtifactConflictError,
  ArtifactNotFoundError,
  ArtifactService,
  ArtifactValidationError,
} from "./index.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

type SeededPlan = {
  userId: string;
  planId: string;
  sourceInvocationId: string;
  targetInvocationId: string;
};

describe("ArtifactService", () => {
  let prisma: PrismaClient;
  let service: ArtifactService;

  beforeAll(() => {
    prisma = createPrismaClient(testDatabaseUrl);
    service = new ArtifactService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates declared outputs idempotently, versions immutably, retains them after cancel, and enforces READ ACL", async () => {
    const seeded = await seedPlan(prisma, {
      sourceType: "TEXT",
      targetType: "TEXT",
      withDataDependency: false,
    });
    const outsider = await createUser(prisma, "artifact-outsider");

    const first = await service.createArtifact({
      actorUserId: seeded.userId,
      creatorInvocationId: seeded.sourceInvocationId,
      outputName: "result",
      type: "TEXT",
      classification: "PRIVATE",
      content: { kind: "INLINE_JSON", value: { text: "v1" } },
    });
    const replay = await service.createArtifact({
      actorUserId: seeded.userId,
      creatorInvocationId: seeded.sourceInvocationId,
      outputName: "result",
      type: "TEXT",
      classification: "PRIVATE",
      content: { kind: "INLINE_JSON", value: { text: "v1" } },
    });
    expect(replay).toEqual(first);

    await expect(
      service.createArtifact({
        actorUserId: seeded.userId,
        creatorInvocationId: seeded.sourceInvocationId,
        outputName: "result",
        type: "TEXT",
        classification: "PRIVATE",
        content: { kind: "INLINE_JSON", value: { text: "conflicting replay" } },
      }),
    ).rejects.toBeInstanceOf(ArtifactConflictError);

    const second = await service.createVersion({
      actorUserId: seeded.userId,
      artifactId: first.artifactId,
      expectedCurrentVersion: 1,
      content: { kind: "INLINE_JSON", value: { text: "v2" } },
    });
    expect(second.version).toBe(2);
    expect(second.artifactVersionId).not.toBe(first.artifactVersionId);

    await expect(
      service.createVersion({
        actorUserId: seeded.userId,
        artifactId: first.artifactId,
        expectedCurrentVersion: 1,
        content: { kind: "INLINE_JSON", value: { text: "v3" } },
      }),
    ).rejects.toBeInstanceOf(ArtifactConflictError);

    const immutableV1 = await service.readVersion({
      actorUserId: seeded.userId,
      artifactVersionId: first.artifactVersionId,
    });
    const immutableV2 = await service.readVersion({
      actorUserId: seeded.userId,
      artifactVersionId: second.artifactVersionId,
    });
    expect(immutableV1.content).toEqual({ kind: "INLINE_JSON", value: { text: "v1" } });
    expect(immutableV2.content).toEqual({ kind: "INLINE_JSON", value: { text: "v2" } });

    await expect(
      service.readVersion({ actorUserId: outsider, artifactVersionId: first.artifactVersionId }),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError);

    await service.grantReadAccess({
      actorUserId: seeded.userId,
      artifactId: first.artifactId,
      granteeUserId: outsider,
    });
    await expect(
      service.readVersion({ actorUserId: outsider, artifactVersionId: first.artifactVersionId }),
    ).resolves.toMatchObject({ artifactId: first.artifactId, version: 1 });

    await service.revokeReadAccess({
      actorUserId: seeded.userId,
      artifactId: first.artifactId,
      granteeUserId: outsider,
    });
    await expect(
      service.readVersion({ actorUserId: outsider, artifactVersionId: first.artifactVersionId }),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError);

    await prisma.executionPlan.update({
      where: { id: seeded.planId },
      data: { status: "CANCELED", completedAt: new Date() },
    });
    await expect(
      service.readVersion({ actorUserId: seeded.userId, artifactVersionId: first.artifactVersionId }),
    ).resolves.toMatchObject({ artifactId: first.artifactId, version: 1 });
  });

  it("rejects undeclared and mismatched outputs and resolves typed DATA bindings to a concrete version", async () => {
    const seeded = await seedPlan(prisma, {
      sourceType: "PROMPT",
      targetType: "PROMPT",
      withDataDependency: true,
    });

    await expect(
      service.createArtifact({
        actorUserId: seeded.userId,
        creatorInvocationId: seeded.sourceInvocationId,
        outputName: "missing",
        type: "PROMPT",
        classification: "PRIVATE",
        content: { kind: "INLINE_JSON", value: { prompt: "x" } },
      }),
    ).rejects.toBeInstanceOf(ArtifactValidationError);

    await expect(
      service.createArtifact({
        actorUserId: seeded.userId,
        creatorInvocationId: seeded.sourceInvocationId,
        outputName: "result",
        type: "TEXT",
        classification: "PRIVATE",
        content: { kind: "INLINE_JSON", value: { prompt: "x" } },
      }),
    ).rejects.toBeInstanceOf(ArtifactValidationError);

    const artifact = await service.createArtifact({
      actorUserId: seeded.userId,
      creatorInvocationId: seeded.sourceInvocationId,
      outputName: "result",
      type: "PROMPT",
      classification: "PRIVATE",
      content: { kind: "INLINE_JSON", value: { prompt: "make an image" } },
    });

    const resolved = await service.resolveInputBindings({
      actorUserId: seeded.userId,
      targetInvocationId: seeded.targetInvocationId,
    });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      inputName: "prompt",
      expectedType: "PROMPT",
      sourceInvocationId: seeded.sourceInvocationId,
      reference: {
        artifactId: artifact.artifactId,
        artifactVersionId: artifact.artifactVersionId,
        version: 1,
        type: "PROMPT",
      },
    });

    const provenance = await service.getProvenance({
      actorUserId: seeded.userId,
      artifactVersionId: artifact.artifactVersionId,
    });
    expect(provenance).toMatchObject({
      creatorInvocationId: seeded.sourceInvocationId,
      planId: seeded.planId,
      reference: { artifactVersionId: artifact.artifactVersionId },
    });
  });

  it("rejects artifact injection through a dependency whose source belongs to another plan", async () => {
    const targetPlan = await seedPlan(prisma, {
      sourceType: "TEXT",
      targetType: "TEXT",
      withDataDependency: false,
    });
    const foreignPlan = await seedPlan(prisma, {
      sourceType: "TEXT",
      targetType: "TEXT",
      withDataDependency: false,
      userId: targetPlan.userId,
    });

    await service.createArtifact({
      actorUserId: targetPlan.userId,
      creatorInvocationId: foreignPlan.sourceInvocationId,
      outputName: "result",
      type: "TEXT",
      classification: "PRIVATE",
      content: { kind: "INLINE_JSON", value: { text: "foreign" } },
    });

    await prisma.invocationDependency.create({
      data: {
        planId: targetPlan.planId,
        fromInvocationId: foreignPlan.sourceInvocationId,
        toInvocationId: targetPlan.targetInvocationId,
        conditionKind: "DATA",
        conditionOutcome: "",
        inputBindings: [
          { inputName: "foreign", sourceOutputName: "result", expectedArtifactType: "TEXT" },
        ],
      },
    });

    await expect(
      service.resolveInputBindings({
        actorUserId: targetPlan.userId,
        targetInvocationId: targetPlan.targetInvocationId,
      }),
    ).rejects.toBeInstanceOf(ArtifactBindingError);
  });
});

async function createUser(prisma: PrismaClient, prefix: string): Promise<string> {
  const suffix = randomUUID();
  const id = `${prefix}-${suffix}`;
  await prisma.user.create({
    data: {
      id,
      name: "Artifact Test User",
      email: `${suffix}@artifact-service.test`,
      emailVerified: true,
    },
  });
  return id;
}

async function seedPlan(
  prisma: PrismaClient,
  options: {
    sourceType: "TEXT" | "PROMPT";
    targetType: "TEXT" | "PROMPT";
    withDataDependency: boolean;
    userId?: string;
  },
): Promise<SeededPlan> {
  const suffix = randomUUID();
  const userId = options.userId ?? (await createUser(prisma, "artifact-owner"));
  const conversationId = randomUUID();
  const messageId = randomUUID();
  const planId = randomUUID();
  const sourceInvocationId = `${planId}:source`;
  const targetInvocationId = `${planId}:target`;

  await prisma.conversation.create({
    data: { id: conversationId, userId, title: "Artifact integration test", kind: "CHAT" },
  });
  await prisma.message.create({
    data: {
      id: messageId,
      conversationId,
      role: "USER",
      content: "Create artifact test plan",
      status: "COMPLETE",
    },
  });
  await prisma.executionPlan.create({
    data: {
      id: planId,
      messageId,
      userId,
      conversationId,
      schemaVersion: 1,
      version: 1,
      planHash: `sha256:${suffix.replaceAll("-", "")}`,
      goal: "Exercise artifact service",
      status: "RUNNING",
      maxParallelism: 2,
      startedAt: new Date(),
      frozenAt: new Date(),
    },
  });
  await prisma.invocation.createMany({
    data: [
      {
        id: sourceInvocationId,
        planId,
        sequence: 0,
        purpose: "Create artifact",
        targetKind: "VIMLA",
        outputDeclarations: [{ name: "result", artifactType: options.sourceType }],
        acceptanceCriteria: [],
        riskClass: "READ_ONLY",
        approvalPolicy: "AUTO",
        failurePolicy: "FAIL_PLAN",
        joinPolicy: "ALL_REQUIRED",
        status: "COMPLETED",
      },
      {
        id: targetInvocationId,
        planId,
        sequence: 1,
        purpose: "Consume artifact",
        targetKind: "VIMLA",
        outputDeclarations: [{ name: "consumed", artifactType: options.targetType }],
        acceptanceCriteria: [],
        riskClass: "READ_ONLY",
        approvalPolicy: "AUTO",
        failurePolicy: "FAIL_PLAN",
        joinPolicy: "ALL_REQUIRED",
        status: "PENDING",
      },
    ],
  });

  if (options.withDataDependency) {
    await prisma.invocationDependency.create({
      data: {
        planId,
        fromInvocationId: sourceInvocationId,
        toInvocationId: targetInvocationId,
        conditionKind: "DATA",
        conditionOutcome: "",
        inputBindings: [
          { inputName: "prompt", sourceOutputName: "result", expectedArtifactType: options.sourceType },
        ],
      },
    });
  }

  return { userId, planId, sourceInvocationId, targetInvocationId };
}
