import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AiRequestReconciler,
  seedVimlaAiModels,
} from "@vimla/ai";
import { BillingEngine, type BillingPolicy } from "@vimla/billing";
import { createPrismaClient, type PrismaClient } from "@vimla/database";
import { AiArtifactRecovery } from "./ai-artifact-recovery.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const policy: BillingPolicy = {
  minTopupMicroRub: 1n,
  maxTopupMicroRub: 1_000_000_000_000n,
  topupProviderCostRatioBps: 3_500n,
  subscriptionPeriodDays: 30,
};

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe("AiRequestReconciler", () => {
  let prisma: PrismaClient;
  let billing: BillingEngine;
  let reconciler: AiRequestReconciler;
  let artifactRecovery: AiArtifactRecovery;

  beforeAll(async () => {
    prisma = createPrismaClient(testDatabaseUrl);
    billing = new BillingEngine(prisma, policy, logger);
    reconciler = new AiRequestReconciler(prisma, billing, logger);
    artifactRecovery = new AiArtifactRecovery(prisma, logger);
    await seedVimlaAiModels(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("releases a stale pre-provider reservation and fails the turn safely", async () => {
    const seeded = await seedTurn(prisma, billing, {
      turnStatus: "RESERVED",
      actualMicroRub: null,
      outputText: null,
    });

    const counters = await reconcileAll(reconciler);

    expect(counters.released).toBeGreaterThanOrEqual(1);
    const request = await prisma.aiRequest.findUniqueOrThrow({
      where: { id: seeded.aiRequestId },
      include: { reservation: true, providerTurn: true },
    });
    expect(request.status).toBe("FAILED");
    expect(request.financialStatus).toBe("RELEASED");
    expect(request.reservation?.status).toBe("RELEASED");
    expect(request.providerTurn?.status).toBe("FAILED_PRE_PROVIDER");
    expect(await spentForUser(prisma, seeded.userId)).toBe(0n);
  });

  it("keeps stale provider-in-flight work on hold when usage is unknown", async () => {
    const seeded = await seedTurn(prisma, billing, {
      turnStatus: "PROVIDER_IN_FLIGHT",
      actualMicroRub: null,
      outputText: "partial",
    });

    await reconcileAll(reconciler);

    const request = await prisma.aiRequest.findUniqueOrThrow({
      where: { id: seeded.aiRequestId },
      include: { reservation: true, providerTurn: true },
    });
    expect(request.status).toBe("RECONCILIATION_REQUIRED");
    expect(request.financialStatus).toBe("RECONCILIATION_HOLD");
    expect(request.reservation?.status).toBe("ACTIVE");
    expect(request.providerTurn?.status).toBe("RECONCILIATION_REQUIRED");
    expect(await spentForUser(prisma, seeded.userId)).toBe(0n);
  });

  it("settles durable usage exactly once and finalizes the provider turn", async () => {
    const seeded = await seedTurn(prisma, billing, {
      turnStatus: "USAGE_DURABLE",
      actualMicroRub: 300_000n,
      outputText: "durable result",
    });

    await reconcileAll(reconciler);
    await reconcileAll(reconciler);

    const request = await prisma.aiRequest.findUniqueOrThrow({
      where: { id: seeded.aiRequestId },
      include: { reservation: true, providerTurn: true },
    });
    expect(request.status).toBe("SUCCEEDED");
    expect(request.financialStatus).toBe("SETTLED");
    expect(request.userSettledUsageMicroRub).toBe(300_000n);
    expect(request.reservation?.status).toBe("SETTLED");
    expect(request.providerTurn?.status).toBe("SUCCEEDED");
    expect(await spentForUser(prisma, seeded.userId)).toBe(300_000n);
    expect(
      await prisma.artifact.count({
        where: { creatorInvocationId: seeded.invocationId },
      }),
    ).toBe(0);

    const recovered = await artifactRecovery.recover(100);
    expect(recovered.recovered).toBeGreaterThanOrEqual(1);
    const artifact = await prisma.artifact.findUniqueOrThrow({
      where: {
        creatorInvocationId_outputName: {
          creatorInvocationId: seeded.invocationId,
          outputName: "result",
        },
      },
      include: { versions: true },
    });
    expect(artifact.versions[0]?.contentJson).toEqual({
      text: "durable result",
    });
    expect(await spentForUser(prisma, seeded.userId)).toBe(300_000n);
  });

  it("recovers a multi-turn artifact from the final provider turn, not the legacy primary turn", async () => {
    const seeded = await seedTurn(prisma, billing, {
      turnStatus: "USAGE_DURABLE",
      actualMicroRub: 200_000n,
      outputText: "intermediate tool request",
    });

    await reconcileAll(reconciler);

    const primary = await prisma.aiRequest.findUniqueOrThrow({
      where: { id: seeded.aiRequestId },
      include: {
        providerTurn: true,
      },
    });
    if (!primary.providerTurn) {
      throw new Error("Primary provider turn missing");
    }
    await prisma.aIProviderTurn.update({
      where: { id: primary.providerTurn.id },
      data: {
        toolCallsJson: [
          {
            id: "call-readme",
            name: "github.readFile",
            arguments: { path: "README.md" },
          },
        ],
      },
    });

    const finalRequest = await prisma.aiRequest.create({
      data: {
        userId: primary.userId,
        conversationId: primary.conversationId,
        modelId: primary.modelId,
        priceVersionId: primary.priceVersionId,
        clientRequestId: `recovery-final:${randomUUID()}`,
        provider: primary.provider,
        providerModelId: primary.providerModelId,
        status: "SUCCEEDED",
        financialStatus: "SETTLED",
        estimatedInputTokens: 1_000,
        maxOutputTokens: 1_000,
        estimatedCostMicroRub: 300_000n,
        providerActualCostMicroRub: 150_000n,
        userSettledUsageMicroRub: 150_000n,
        actualInputTokens: 500,
        actualOutputTokens: 100,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputText: "final multi-turn answer",
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });
    await prisma.aIProviderTurn.create({
      data: {
        aiExecutionId: primary.providerTurn.aiExecutionId,
        turnIndex: 1,
        aiRequestId: finalRequest.id,
        idempotencyKey: `recovery-final-turn:${randomUUID()}`,
        status: "SUCCEEDED",
        toolCallsJson: [],
      },
    });

    const recovered = await artifactRecovery.recover(100);
    expect(recovered.recovered).toBeGreaterThanOrEqual(1);
    const artifact = await prisma.artifact.findUniqueOrThrow({
      where: {
        creatorInvocationId_outputName: {
          creatorInvocationId: seeded.invocationId,
          outputName: "result",
        },
      },
      include: { versions: true },
    });
    expect(artifact.versions[0]?.contentJson).toEqual({
      text: "final multi-turn answer",
    });
  });

  it("recovers an unlinked pre-provider reservation", async () => {
    const seeded = await seedTurn(prisma, billing, {
      turnStatus: "RESERVED",
      actualMicroRub: null,
      outputText: null,
    });
    const request = await prisma.aiRequest.findUniqueOrThrow({
      where: { id: seeded.aiRequestId },
      include: { providerTurn: true, reservation: true },
    });
    if (!request.providerTurn || !request.reservation) {
      throw new Error("Seeded reservation or provider turn missing");
    }

    await prisma.$transaction([
      prisma.aiRequest.update({
        where: { id: request.id },
        data: {
          reservationId: null,
          status: "CREATED",
          financialStatus: "NONE",
        },
      }),
      prisma.aIProviderTurn.update({
        where: { id: request.providerTurn.id },
        data: { status: "CREATED" },
      }),
    ]);

    await reconcileAll(reconciler);

    const recovered = await prisma.aiRequest.findUniqueOrThrow({
      where: { id: request.id },
      include: { providerTurn: true },
    });
    const reservation = await prisma.usageReservation.findUniqueOrThrow({
      where: { id: request.reservation.id },
    });
    expect(recovered.status).toBe("FAILED");
    expect(recovered.financialStatus).toBe("RELEASED");
    expect(recovered.providerTurn?.status).toBe("FAILED_PRE_PROVIDER");
    expect(reservation.status).toBe("RELEASED");
    expect(await spentForUser(prisma, seeded.userId)).toBe(0n);
  });

  it("never tops up a reservation when durable actual cost exceeds the funded cap", async () => {
    const seeded = await seedTurn(prisma, billing, {
      turnStatus: "USAGE_DURABLE",
      actualMicroRub: 1_100_000n,
      outputText: "over funded bound",
    });

    await reconcileAll(reconciler);

    const request = await prisma.aiRequest.findUniqueOrThrow({
      where: { id: seeded.aiRequestId },
      include: { reservation: true, providerTurn: true },
    });
    expect(request.status).toBe("RECONCILIATION_REQUIRED");
    expect(request.financialStatus).toBe("RECONCILIATION_HOLD");
    expect(request.reservation?.status).toBe("ACTIVE");
    expect(request.providerTurn?.status).toBe("RECONCILIATION_REQUIRED");
    expect(await spentForUser(prisma, seeded.userId)).toBe(0n);
  });
});

async function reconcileAll(reconciler: AiRequestReconciler) {
  const future = new Date(Date.now() + 60_000);
  return reconciler.reconcile(
    { preProvider: future, provider: future },
    100,
  );
}

async function seedTurn(
  prisma: PrismaClient,
  billing: BillingEngine,
  input: {
    turnStatus: string;
    actualMicroRub: bigint | null;
    outputText: string | null;
  },
) {
  const suffix = randomUUID();
  const userId = `ai-reconcile-user-${suffix}`;
  const conversationId = randomUUID();
  const messageId = randomUUID();
  const planId = randomUUID();
  const invocationId = randomUUID();
  const runId = randomUUID();

  await prisma.user.create({
    data: {
      id: userId,
      name: "AI Reconciliation Test",
      email: `${suffix}@ai-reconcile.test`,
      emailVerified: true,
    },
  });
  await prisma.usageBucket.create({
    data: {
      userId,
      type: "TOPUP",
      totalMicroRub: 5_000_000n,
      spentMicroRub: 0n,
      reservedMicroRub: 0n,
      expiresAt: null,
      sourceType: "TEST",
      sourceId: `ai-reconcile:${suffix}`,
    },
  });
  await prisma.conversation.create({
    data: {
      id: conversationId,
      userId,
      title: "AI reconcile",
      kind: "CHAT",
    },
  });
  await prisma.message.create({
    data: {
      id: messageId,
      conversationId,
      role: "USER",
      content: "reconcile",
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
      goal: "reconcile",
      status: "RUNNING",
      maxParallelism: 1,
      startedAt: new Date(),
      frozenAt: new Date(),
    },
  });
  await prisma.invocation.create({
    data: {
      id: invocationId,
      planId,
      sequence: 0,
      purpose: "reconcile",
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      targetAgentId: null,
      outputDeclarations: [{ name: "result", artifactType: "TEXT" }],
      acceptanceCriteria: [],
      riskClass: "READ_ONLY",
      approvalPolicy: "AUTO",
      failurePolicy: "FAIL_PLAN",
      joinPolicy: "ALL_REQUIRED",
      status: "RUNNING",
    },
  });
  await prisma.invocationRun.create({
    data: {
      id: runId,
      invocationId,
      attempt: 1,
      idempotencyKey: `${invocationId}:attempt:1`,
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  const model = await prisma.aiModel.findUniqueOrThrow({
    where: { slug: "gpt-5-6-luna" },
    include: {
      priceVersions: {
        where: { effectiveTo: null },
        orderBy: { effectiveFrom: "desc" },
        take: 1,
      },
    },
  });
  const price = model.priceVersions[0];
  if (!price) throw new Error("Seeded model has no price version");

  const aiRequest = await prisma.aiRequest.create({
    data: {
      userId,
      conversationId,
      modelId: model.id,
      priceVersionId: price.id,
      clientRequestId: `reconcile:${suffix}`,
      provider: model.provider,
      providerModelId: model.providerModelId,
      status:
        input.turnStatus === "RESERVED"
          ? "RESERVED"
          : input.turnStatus === "PROVIDER_IN_FLIGHT"
            ? "STREAMING"
            : "STREAMING",
      financialStatus: "RESERVED",
      estimatedInputTokens: 100,
      maxOutputTokens: 1_000,
      estimatedCostMicroRub: 1_000_000n,
      providerActualCostMicroRub: input.actualMicroRub,
      actualInputTokens: input.actualMicroRub === null ? null : 100,
      actualOutputTokens: input.actualMicroRub === null ? null : 100,
      reasoningTokens: input.actualMicroRub === null ? null : 0,
      cacheReadTokens: input.actualMicroRub === null ? null : 0,
      cacheWriteTokens: input.actualMicroRub === null ? null : 0,
      outputText: input.outputText,
      startedAt: input.turnStatus === "RESERVED" ? null : new Date(),
    },
  });
  const reservation = await billing.reserveUsage({
    userId,
    requestId: aiRequest.id,
    estimatedProviderCostMicroRub: 1_000_000n,
  });
  await prisma.aiRequest.update({
    where: { id: aiRequest.id },
    data: {
      reservationId: reservation.id,
      financialStatus: "RESERVED",
    },
  });
  const execution = await prisma.aIExecution.create({
    data: {
      invocationRunId: runId,
      aiRequestId: aiRequest.id,
    },
  });
  await prisma.aIProviderTurn.create({
    data: {
      aiExecutionId: execution.id,
      turnIndex: 0,
      aiRequestId: aiRequest.id,
      idempotencyKey: `reconcile:${suffix}:turn:0`,
      status: input.turnStatus,
    },
  });

  return { userId, aiRequestId: aiRequest.id, invocationId };
}

async function spentForUser(
  prisma: PrismaClient,
  userId: string,
): Promise<bigint> {
  const buckets = await prisma.usageBucket.findMany({ where: { userId } });
  return buckets.reduce((sum, bucket) => sum + bucket.spentMicroRub, 0n);
}
