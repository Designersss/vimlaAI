import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MockAiProvider,
  VimlaAiGateway,
  seedVimlaAiModels,
} from "@vimla/ai";
import { BillingEngine, type BillingPolicy } from "@vimla/billing";
import { createPrismaClient, type PrismaClient } from "@vimla/database";
import {
  ExternalAiInvocationExecutor,
  orchestrationAiClientRequestId,
} from "./external-ai-invocation-executor.js";
import type { InvocationExecutionInput } from "./orchestration.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const billingPolicy: BillingPolicy = {
  minTopupMicroRub: 1n,
  maxTopupMicroRub: 1_000_000_000_000n,
  topupProviderCostRatioBps: 3_500n,
  subscriptionPeriodDays: 30,
};

describe("ExternalAiInvocationExecutor", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createPrismaClient(testDatabaseUrl);
    await seedVimlaAiModels(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("executes an exact approved model, settles billing, links AiRequest provenance, and emits an Artifact", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Write a short launch note",
      fund: true,
    });
    const provider = new MockAiProvider();
    provider.text = "Launch note from model";
    const executor = createExecutor(prisma, provider);

    const result = await executor.execute(executionInput(seeded, {
      kind: "AI_MODEL",
      modelSlug: "gpt-5-6-luna",
      agentId: null,
    }));

    expect(result).toEqual({ status: "COMPLETED", outcome: "PASS" });
    expect(provider.callCount).toBe(1);
    expect(provider.lastRequest?.providerModelId).toBe("openai/gpt-5.6-luna");

    const request = await prisma.aiRequest.findUniqueOrThrow({
      where: {
        userId_clientRequestId: {
          userId: seeded.userId,
          clientRequestId: orchestrationAiClientRequestId(seeded.invocationId),
        },
      },
      include: {
        reservation: true,
        aiExecution: true,
      },
    });
    expect(request.status).toBe("SUCCEEDED");
    expect(request.financialStatus).toBe("SETTLED");
    expect(request.outputText).toBe("Launch note from model");
    expect(request.reservation?.status).toBe("SETTLED");
    expect(request.aiExecution?.invocationRunId).toBe(seeded.runId);

    const artifact = await prisma.artifact.findUniqueOrThrow({
      where: {
        creatorInvocationId_outputName: {
          creatorInvocationId: seeded.invocationId,
          outputName: "result",
        },
      },
      include: { versions: true },
    });
    expect(artifact.type).toBe("TEXT");
    expect(artifact.versions).toHaveLength(1);
    expect(artifact.versions[0]?.contentJson).toEqual({
      text: "Launch note from model",
    });
  });

  it("replays a completed invocation without another provider call, reservation, charge, or artifact", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Write idempotent copy",
      fund: true,
    });
    const provider = new MockAiProvider();
    provider.text = "One paid result";
    const executor = createExecutor(prisma, provider);

    const first = await executor.execute(executionInput(seeded, {
      kind: "AI_MODEL",
      modelSlug: "gpt-5-6-luna",
      agentId: null,
    }));
    expect(first.status).toBe("COMPLETED");

    const secondRun = await prisma.invocationRun.create({
      data: {
        invocationId: seeded.invocationId,
        attempt: 2,
        idempotencyKey: `${seeded.invocationId}:attempt:2`,
        status: "RUNNING",
        startedAt: new Date(),
      },
    });
    const replay = await executor.execute({
      ...executionInput(seeded, {
        kind: "AI_MODEL",
        modelSlug: "gpt-5-6-luna",
        agentId: null,
      }),
      attempt: 2,
      runId: secondRun.id,
      idempotencyKey: secondRun.idempotencyKey,
    });

    expect(replay).toEqual({ status: "COMPLETED", outcome: "REPLAYED" });
    expect(provider.callCount).toBe(1);
    expect(
      await prisma.aiRequest.count({
        where: {
          userId: seeded.userId,
          clientRequestId: orchestrationAiClientRequestId(seeded.invocationId),
        },
      }),
    ).toBe(1);
    expect(
      await prisma.usageReservation.count({
        where: {
          userId: seeded.userId,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.artifact.count({
        where: { creatorInvocationId: seeded.invocationId },
      }),
    ).toBe(1);
  });

  it("blocks an invocation before provider execution when usage budget is insufficient", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "This should not reach the provider",
      fund: false,
    });
    const provider = new MockAiProvider();
    const executor = createExecutor(prisma, provider);

    const result = await executor.execute(executionInput(seeded, {
      kind: "AI_MODEL",
      modelSlug: "gpt-5-6-luna",
      agentId: null,
    }));

    expect(result).toEqual({
      status: "FAILED",
      errorCode: "BILLING_INSUFFICIENT_USAGE",
      retryable: false,
    });
    expect(provider.callCount).toBe(0);
    expect(
      await prisma.artifact.count({
        where: { creatorInvocationId: seeded.invocationId },
      }),
    ).toBe(0);
  });

  it("shrinks the provider output cap to a fully funded budget when allowance is low", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Use only the remaining funded allowance",
      fund: true,
      fundMicroRub: 500_000n,
    });
    const provider = new MockAiProvider();
    const executor = createExecutor(prisma, provider);

    const result = await executor.execute(executionInput(seeded, {
      kind: "AI_MODEL",
      modelSlug: "gpt-5-6-luna",
      agentId: null,
    }));

    expect(result).toEqual({ status: "COMPLETED", outcome: "PASS" });
    const request = await prisma.aiRequest.findUniqueOrThrow({
      where: {
        userId_clientRequestId: {
          userId: seeded.userId,
          clientRequestId: orchestrationAiClientRequestId(seeded.invocationId),
        },
      },
      include: { reservation: true },
    });
    expect(request.maxOutputTokens).toBeGreaterThanOrEqual(768);
    expect(request.maxOutputTokens).toBeLessThan(2_048);
    expect(request.estimatedCostMicroRub).toBeLessThanOrEqual(500_000n);
    expect(request.reservation?.estimatedMicroRub).toBe(request.estimatedCostMicroRub);
    expect(provider.lastRequest?.maxOutputTokens).toBe(request.maxOutputTokens);
  });

  it("does not spend the final allowance when it cannot fund the minimum useful output", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Do not start if the result would be predictably truncated",
      fund: true,
      fundMicroRub: 300_000n,
    });
    const provider = new MockAiProvider();
    const executor = createExecutor(prisma, provider);

    const result = await executor.execute(executionInput(seeded, {
      kind: "AI_MODEL",
      modelSlug: "gpt-5-6-luna",
      agentId: null,
    }));

    expect(result).toEqual({
      status: "FAILED",
      errorCode: "BILLING_INSUFFICIENT_USAGE",
      retryable: false,
    });
    expect(provider.callCount).toBe(0);
    expect(
      await prisma.aiRequest.count({
        where: { userId: seeded.userId },
      }),
    ).toBe(0);
  });

  it("selects AI_AUTO server-side and persists the concrete selected model", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_AUTO",
      targetModelSlug: null,
      purpose: "Pick an approved model automatically",
      fund: true,
    });
    const provider = new MockAiProvider();
    const executor = createExecutor(prisma, provider);

    const result = await executor.execute(executionInput(seeded, {
      kind: "AI_AUTO",
      modelSlug: null,
      agentId: null,
    }));

    expect(result.status).toBe("COMPLETED");
    const request = await prisma.aiRequest.findUniqueOrThrow({
      where: {
        userId_clientRequestId: {
          userId: seeded.userId,
          clientRequestId: orchestrationAiClientRequestId(seeded.invocationId),
        },
      },
      include: { model: true },
    });
    expect(request.model.active).toBe(true);
    expect(request.model.visible).toBe(true);
    expect(provider.lastRequest?.providerModelId).toBe(request.model.providerModelId);
  });

  it("does not silently fall back when the exact requested model is unavailable", async () => {
    const unavailableSlug = `unavailable-test-model-${randomUUID()}`;
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: unavailableSlug,
      purpose: "Use exactly the unavailable model",
      fund: true,
    });
    const provider = new MockAiProvider();
    const executor = createExecutor(prisma, provider);

    const result = await executor.execute(executionInput(seeded, {
      kind: "AI_MODEL",
      modelSlug: unavailableSlug,
      agentId: null,
    }));

    expect(result).toEqual({
      status: "FAILED",
      errorCode: "AI_MODEL_UNAVAILABLE",
      retryable: false,
    });
    expect(provider.callCount).toBe(0);
    expect(
      await prisma.aiRequest.count({
        where: { userId: seeded.userId },
      }),
    ).toBe(0);
  });

  it("keeps an ambiguous provider outcome in reconciliation hold instead of releasing or retrying it", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Ambiguous provider outcome",
      fund: true,
    });
    const provider = new MockAiProvider();
    provider.scenario = "ambiguous";
    const executor = createExecutor(prisma, provider);

    const result = await executor.execute(executionInput(seeded, {
      kind: "AI_MODEL",
      modelSlug: "gpt-5-6-luna",
      agentId: null,
    }));

    expect(result).toEqual({
      status: "FAILED",
      errorCode: "AI_RECONCILIATION_REQUIRED",
      retryable: false,
    });
    const request = await prisma.aiRequest.findUniqueOrThrow({
      where: {
        userId_clientRequestId: {
          userId: seeded.userId,
          clientRequestId: orchestrationAiClientRequestId(seeded.invocationId),
        },
      },
      include: { reservation: true },
    });
    expect(request.status).toBe("RECONCILIATION_REQUIRED");
    expect(request.financialStatus).toBe("RECONCILIATION_HOLD");
    expect(request.reservation?.status).toBe("ACTIVE");
  });
});

function createExecutor(
  prisma: PrismaClient,
  provider: MockAiProvider,
): ExternalAiInvocationExecutor {
  return new ExternalAiInvocationExecutor(
    prisma,
    new BillingEngine(prisma, billingPolicy),
    new VimlaAiGateway(provider),
    {
      budgetProfiles: {
        SHORT: {
          preferredOutputTokens: 512,
          minimumOutputTokens: 128,
        },
        STANDARD: {
          preferredOutputTokens: 2_048,
          minimumOutputTokens: 768,
        },
        LONG: {
          preferredOutputTokens: 4_096,
          minimumOutputTokens: 2_048,
        },
      },
      reservationSafetyBps: 2_000n,
      maxReservationMicroRub: 10_000_000n,
    },
  );
}

type SeededInvocation = {
  userId: string;
  planId: string;
  invocationId: string;
  runId: string;
  runIdempotencyKey: string;
};

async function seedInvocation(
  prisma: PrismaClient,
  input: {
    targetKind: "AI_AUTO" | "AI_MODEL";
    targetModelSlug: string | null;
    purpose: string;
    fund: boolean;
    fundMicroRub?: bigint;
  },
): Promise<SeededInvocation> {
  const suffix = randomUUID();
  const userId = `ai-executor-user-${suffix}`;
  const conversationId = randomUUID();
  const messageId = randomUUID();
  const planId = randomUUID();
  const invocationId = randomUUID();

  await prisma.user.create({
    data: {
      id: userId,
      name: "External AI Executor Test",
      email: `${suffix}@external-ai-executor.test`,
      emailVerified: true,
    },
  });
  if (input.fund) {
    await prisma.usageBucket.create({
      data: {
        userId,
        type: "TOPUP",
        totalMicroRub: input.fundMicroRub ?? 100_000_000n,
        spentMicroRub: 0n,
        reservedMicroRub: 0n,
        expiresAt: null,
        sourceType: "TEST",
        sourceId: `external-ai-executor:${suffix}`,
      },
    });
  }
  await prisma.conversation.create({
    data: {
      id: conversationId,
      userId,
      title: "External AI executor",
      kind: "CHAT",
    },
  });
  await prisma.message.create({
    data: {
      id: messageId,
      conversationId,
      role: "USER",
      content: input.purpose,
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
      goal: input.purpose,
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
      purpose: input.purpose,
      targetKind: input.targetKind,
      targetModelSlug: input.targetModelSlug,
      targetAgentId: null,
      outputDeclarations: [
        {
          name: "result",
          artifactType: "TEXT",
        },
      ],
      acceptanceCriteria: [],
      riskClass: "READ_ONLY",
      approvalPolicy: "AUTO",
      failurePolicy: "FAIL_PLAN",
      joinPolicy: "ALL_REQUIRED",
      status: "RUNNING",
    },
  });
  const run = await prisma.invocationRun.create({
    data: {
      invocationId,
      attempt: 1,
      idempotencyKey: `${invocationId}:attempt:1`,
      status: "RUNNING",
      startedAt: new Date(),
    },
  });
  return {
    userId,
    planId,
    invocationId,
    runId: run.id,
    runIdempotencyKey: run.idempotencyKey,
  };
}

function executionInput(
  seeded: SeededInvocation,
  target:
    | { kind: "AI_AUTO"; modelSlug: null; agentId: null }
    | { kind: "AI_MODEL"; modelSlug: string; agentId: null },
): InvocationExecutionInput {
  return {
    planId: seeded.planId,
    invocationId: seeded.invocationId,
    attempt: 1,
    runId: seeded.runId,
    idempotencyKey: seeded.runIdempotencyKey,
    target,
  };
}
