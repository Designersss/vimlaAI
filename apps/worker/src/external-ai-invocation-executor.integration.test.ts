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
  orchestrationAiProviderTurnIdempotencyKey,
  type ExternalAiExecutorConfig,
} from "./external-ai-invocation-executor.js";
import type { ExternalAiToolBroker } from "./external-ai-tool-broker.js";
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
        providerTurn: true,
      },
    });
    expect(request.status).toBe("SUCCEEDED");
    expect(request.financialStatus).toBe("SETTLED");
    expect(request.outputText).toBe("Launch note from model");
    expect(request.reservation?.status).toBe("SETTLED");
    expect(request.aiExecution?.invocationRunId).toBe(seeded.runId);
    expect(request.providerTurn?.turnIndex).toBe(0);
    expect(request.providerTurn?.status).toBe("SUCCEEDED");
    expect(request.providerTurn?.idempotencyKey).toBe(
      orchestrationAiProviderTurnIdempotencyKey(seeded.invocationId, 0),
    );

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
      status: "BLOCKED_INSUFFICIENT_USAGE",
      errorCode: "BILLING_INSUFFICIENT_USAGE",
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
      status: "BLOCKED_INSUFFICIENT_USAGE",
      errorCode: "BILLING_INSUFFICIENT_USAGE",
    });
    expect(provider.callCount).toBe(0);
    expect(
      await prisma.aiRequest.count({
        where: { userId: seeded.userId },
      }),
    ).toBe(0);
  });

  it("selects AI_AUTO server-side and persists the concrete selected model", async () => {
    const unboundedSlug = `unbounded-auto-${randomUUID()}`;
    await seedUnboundedModel(prisma, unboundedSlug);
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
    expect(request.model.slug).not.toBe(unboundedSlug);
    expect(provider.lastRequest?.providerModelId).toBe(request.model.providerModelId);
  });

  it("fails closed for an exact model without a hard-bounded billing policy", async () => {
    const unboundedSlug = `unbounded-exact-${randomUUID()}`;
    await seedUnboundedModel(prisma, unboundedSlug);
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: unboundedSlug,
      purpose: "Do not run an unverified billing model",
      fund: true,
    });
    const provider = new MockAiProvider();
    const executor = createExecutor(prisma, provider);

    const result = await executor.execute(executionInput(seeded, {
      kind: "AI_MODEL",
      modelSlug: unboundedSlug,
      agentId: null,
    }));

    expect(result).toEqual({
      status: "FAILED",
      errorCode: "AI_MODEL_BILLING_UNBOUNDED",
      retryable: false,
    });
    expect(provider.callCount).toBe(0);
    expect(
      await prisma.aiRequest.count({ where: { userId: seeded.userId } }),
    ).toBe(0);
  });

  it("holds instead of charging beyond the funded provider token cap", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Provider must stay inside the funded cap",
      fund: true,
    });
    const provider = new MockAiProvider();
    provider.scenario = "expensive";
    const executor = createExecutor(prisma, provider);

    const result = await executor.execute(executionInput(seeded, {
      kind: "AI_MODEL",
      modelSlug: "gpt-5-6-luna",
      agentId: null,
    }));

    expect(result).toEqual({
      status: "FAILED",
      errorCode: "AI_PROVIDER_BOUNDEDNESS_VIOLATION",
      retryable: false,
    });
    const request = await prisma.aiRequest.findUniqueOrThrow({
      where: {
        userId_clientRequestId: {
          userId: seeded.userId,
          clientRequestId: orchestrationAiClientRequestId(seeded.invocationId),
        },
      },
      include: { reservation: true, providerTurn: true },
    });
    expect(request.status).toBe("RECONCILIATION_REQUIRED");
    expect(request.financialStatus).toBe("RECONCILIATION_HOLD");
    expect(request.reservation?.status).toBe("ACTIVE");
    expect(request.providerTurn?.status).toBe("RECONCILIATION_REQUIRED");
    const bucket = await prisma.usageBucket.findFirstOrThrow({
      where: { userId: seeded.userId },
    });
    expect(bucket.spentMicroRub).toBe(0n);
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

  it("funds each tool-loop turn independently and resumes after top-up without replaying paid work", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Read the repository file and summarize it",
      fund: true,
      fundMicroRub: 1_000_000n,
    });
    const provider = new MockAiProvider();
    provider.text = "Final repository summary";
    provider.toolCallQueue.push([
      {
        id: "call-readme",
        name: "github.readFile",
        arguments: { path: "README.md" },
      },
    ]);
    const tools = new TestToolBroker("x".repeat(80_000));
    const executor = createExecutor(prisma, provider, tools);

    const first = await executor.execute(executionInput(seeded, {
      kind: "AI_MODEL",
      modelSlug: "gpt-5-6-luna",
      agentId: null,
    }));

    expect(first).toEqual({
      status: "BLOCKED_INSUFFICIENT_USAGE",
      errorCode: "BILLING_INSUFFICIENT_USAGE",
    });
    expect(provider.callCount).toBe(1);
    expect(tools.calls).toHaveLength(1);

    const firstTurn = await prisma.aIProviderTurn.findUniqueOrThrow({
      where: {
        idempotencyKey: orchestrationAiProviderTurnIdempotencyKey(
          seeded.invocationId,
          0,
        ),
      },
      include: { aiRequest: { include: { reservation: true } } },
    });
    expect(firstTurn.status).toBe("SUCCEEDED");
    expect(firstTurn.aiRequest.status).toBe("SUCCEEDED");
    expect(firstTurn.aiRequest.reservation?.status).toBe("SETTLED");
    expect(firstTurn.toolCallsJson).toEqual([
      {
        id: "call-readme",
        name: "github.readFile",
        arguments: { path: "README.md" },
      },
    ]);
    expect(firstTurn.toolResultsJson).not.toBeNull();

    await prisma.usageBucket.create({
      data: {
        userId: seeded.userId,
        type: "TOPUP",
        totalMicroRub: 10_000_000n,
        spentMicroRub: 0n,
        reservedMicroRub: 0n,
        expiresAt: null,
        sourceType: "TEST",
        sourceId: `tool-loop-topup:${randomUUID()}`,
      },
    });
    const resumeRun = await prisma.invocationRun.create({
      data: {
        invocationId: seeded.invocationId,
        attempt: 2,
        idempotencyKey: `${seeded.invocationId}:attempt:2`,
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    const resumed = await executor.execute({
      ...executionInput(seeded, {
        kind: "AI_MODEL",
        modelSlug: "gpt-5-6-luna",
        agentId: null,
      }),
      attempt: 2,
      runId: resumeRun.id,
      idempotencyKey: resumeRun.idempotencyKey,
    });

    expect(resumed).toEqual({ status: "COMPLETED", outcome: "PASS" });
    expect(provider.callCount).toBe(2);
    expect(tools.calls).toHaveLength(1);
    expect(
      provider.requests[1]?.messages.some((message) => message.role === "tool"),
    ).toBe(true);

    const turns = await prisma.aIProviderTurn.findMany({
      where: {
        aiExecution: {
          invocationRun: {
            invocationId: seeded.invocationId,
          },
        },
      },
      orderBy: { turnIndex: "asc" },
      include: { aiRequest: { include: { reservation: true } } },
    });
    expect(turns).toHaveLength(2);
    expect(turns.map((turn) => turn.turnIndex)).toEqual([0, 1]);
    expect(turns.map((turn) => turn.idempotencyKey)).toEqual([
      orchestrationAiProviderTurnIdempotencyKey(seeded.invocationId, 0),
      orchestrationAiProviderTurnIdempotencyKey(seeded.invocationId, 1),
    ]);
    expect(turns[1]?.aiRequest.estimatedInputTokens).toBeGreaterThan(
      turns[0]?.aiRequest.estimatedInputTokens ?? 0,
    );
    expect(
      turns.every((turn) => turn.aiRequest.reservation?.status === "SETTLED"),
    ).toBe(true);
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
  toolBroker?: ExternalAiToolBroker,
  overrides: Partial<ExternalAiExecutorConfig> = {},
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
      ...overrides,
    },
    toolBroker,
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

async function seedSiblingInvocation(
  prisma: PrismaClient,
  seeded: SeededInvocation,
  sequence = 1,
): Promise<SeededInvocation> {
  const invocationId = randomUUID();
  await prisma.invocation.create({
    data: {
      id: invocationId,
      planId: seeded.planId,
      sequence,
      purpose: "Second paid invocation in the same plan",
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
    ...seeded,
    invocationId,
    runId: run.id,
    runIdempotencyKey: run.idempotencyKey,
  };
}

async function seedUnboundedModel(
  prisma: PrismaClient,
  slug: string,
): Promise<void> {
  const model = await prisma.aiModel.create({
    data: {
      slug,
      displayName: "Unbounded Test Model",
      vendor: "test",
      provider: "proxyapi",
      providerModelId: `test/${slug}`,
      active: true,
      visible: true,
      supportsStreaming: true,
      contextWindowTokens: 128_000,
      maxOutputTokens: 16_384,
    },
  });
  await prisma.aiModelPriceVersion.create({
    data: {
      modelId: model.id,
      inputMicroRubPerMillion: 1n,
      outputMicroRubPerMillion: 1n,
      cacheReadMicroRubPerMillion: null,
      cacheWriteMicroRubPerMillion: null,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      effectiveTo: null,
      verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      source: "test-unbounded-model",
    },
  });
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


class TestToolBroker implements ExternalAiToolBroker {
  readonly calls: Array<{ name: string; idempotencyKey: string }> = [];

  constructor(private readonly fileContent: string) {}

  async listTools() {
    return [
      {
        name: "github.readFile",
        description: "Read an authorized repository file",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
          },
          required: ["path"],
          additionalProperties: false,
        },
      },
    ] as const;
  }

  async execute(input: Parameters<ExternalAiToolBroker["execute"]>[0]) {
    this.calls.push({
      name: input.call.name,
      idempotencyKey: input.idempotencyKey,
    });
    return {
      path: String(input.call.arguments.path ?? ""),
      content: this.fileContent,
    };
  }
}
