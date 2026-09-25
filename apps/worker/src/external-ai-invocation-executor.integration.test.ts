import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MockAiProvider,
  ProviderCallError,
  VimlaAiGateway,
  providerCostFromUsage,
  seedVimlaAiModels,
  type AiProvider,
  type ProviderChatRequest,
  type ProviderChatResult,
  type ProviderStreamEvent,
} from "@vimla/ai";
import { ArtifactService } from "@vimla/artifacts";
import {
  BillingEngine,
  BillingError,
  type BillingPolicy,
} from "@vimla/billing";
import type { ContextBundleView } from "@vimla/context";
import { createPrismaClient, type PrismaClient } from "@vimla/database";
import type { TelemetryEvent, TelemetrySink } from "@vimla/shared";
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
    const telemetry = recordingTelemetry();
    const executor = createExecutor(
      prisma,
      provider,
      undefined,
      {},
      undefined,
      telemetry.sink,
    );

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
    expect(telemetry.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "economics.ai",
          planId: seeded.planId,
          invocationId: seeded.invocationId,
          aiRequestId: request.id,
          providerClass: "PAID_EXTERNAL",
          modelClass: "gpt-5-6-luna",
          outcome: "SUCCESS",
        }),
      ]),
    );
  });

  it("never sends a restricted dependency artifact to an external provider", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Use restricted dependency",
      fund: true,
    });
    const sourceInvocationId = randomUUID();
    await prisma.invocation.create({
      data: {
        id: sourceInvocationId,
        planId: seeded.planId,
        sequence: 1,
        purpose: "Produce restricted input",
        targetKind: "VIMLA",
        targetModelSlug: null,
        targetAgentId: null,
        outputDeclarations: [{ name: "result", artifactType: "TEXT" }],
        acceptanceCriteria: [],
        riskClass: "READ_ONLY",
        approvalPolicy: "AUTO",
        failurePolicy: "FAIL_PLAN",
        joinPolicy: "ALL_REQUIRED",
        status: "COMPLETED",
      },
    });
    await prisma.invocationDependency.create({
      data: {
        id: randomUUID(),
        planId: seeded.planId,
        fromInvocationId: sourceInvocationId,
        toInvocationId: seeded.invocationId,
        conditionKind: "DATA",
        conditionOutcome: "",
        inputBindings: [
          {
            inputName: "restrictedInput",
            sourceOutputName: "result",
            expectedArtifactType: "TEXT",
          },
        ],
      },
    });
    await new ArtifactService(prisma).createArtifact({
      actorUserId: seeded.userId,
      creatorInvocationId: sourceInvocationId,
      outputName: "result",
      type: "TEXT",
      classification: "RESTRICTED",
      content: {
        kind: "INLINE_JSON",
        value: { text: "must not leave Vimla" },
      },
    });

    const provider = new MockAiProvider();
    const executor = createExecutor(prisma, provider);
    await expect(
      executor.execute(
        executionInput(seeded, {
          kind: "AI_MODEL",
          modelSlug: "gpt-5-6-luna",
          agentId: null,
        }),
      ),
    ).resolves.toEqual({
      status: "FAILED",
      errorCode: "AI_ARTIFACT_CLASSIFICATION_DENIED",
      retryable: false,
    });
    expect(provider.callCount).toBe(0);
    expect(
      await prisma.aiRequest.count({ where: { userId: seeded.userId } }),
    ).toBe(0);
  });

  it("never sends a sensitive PRIVATE dependency artifact to an external provider", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Use private dependency",
      fund: true,
    });
    const sourceInvocationId = randomUUID();
    await prisma.invocation.create({
      data: {
        id: sourceInvocationId,
        planId: seeded.planId,
        sequence: 1,
        purpose: "Produce sensitive input",
        targetKind: "VIMLA",
        targetModelSlug: null,
        targetAgentId: null,
        outputDeclarations: [{ name: "result", artifactType: "TEXT" }],
        acceptanceCriteria: [],
        riskClass: "READ_ONLY",
        approvalPolicy: "AUTO",
        failurePolicy: "FAIL_PLAN",
        joinPolicy: "ALL_REQUIRED",
        status: "COMPLETED",
      },
    });
    await prisma.invocationDependency.create({
      data: {
        id: randomUUID(),
        planId: seeded.planId,
        fromInvocationId: sourceInvocationId,
        toInvocationId: seeded.invocationId,
        conditionKind: "DATA",
        conditionOutcome: "",
        inputBindings: [
          {
            inputName: "privateInput",
            sourceOutputName: "result",
            expectedArtifactType: "TEXT",
          },
        ],
      },
    });
    await new ArtifactService(prisma).createArtifact({
      actorUserId: seeded.userId,
      creatorInvocationId: sourceInvocationId,
      outputName: "result",
      type: "TEXT",
      classification: "PRIVATE",
      content: {
        kind: "INLINE_JSON",
        value: {
          text: "access_token: abcdefghijklmnopqrstuvwxyz123456",
        },
      },
    });

    const provider = new MockAiProvider();
    const executor = createExecutor(prisma, provider);
    await expect(
      executor.execute(
        executionInput(seeded, {
          kind: "AI_MODEL",
          modelSlug: "gpt-5-6-luna",
          agentId: null,
        }),
      ),
    ).resolves.toEqual({
      status: "FAILED",
      errorCode: "AI_ARTIFACT_SENSITIVE_DATA_DENIED",
      retryable: false,
    });
    expect(provider.callCount).toBe(0);
    expect(
      await prisma.aiRequest.count({ where: { userId: seeded.userId } }),
    ).toBe(0);
  });

  it("uses the exact artifact version frozen in ContextBundle even when a newer version exists", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Use the frozen dependency version",
      fund: true,
    });
    const sourceInvocationId = randomUUID();
    await prisma.invocation.create({
      data: {
        id: sourceInvocationId,
        planId: seeded.planId,
        sequence: 1,
        purpose: "Produce versioned input",
        targetKind: "VIMLA",
        targetModelSlug: null,
        targetAgentId: null,
        outputDeclarations: [{ name: "result", artifactType: "TEXT" }],
        acceptanceCriteria: [],
        riskClass: "READ_ONLY",
        approvalPolicy: "AUTO",
        failurePolicy: "FAIL_PLAN",
        joinPolicy: "ALL_REQUIRED",
        status: "COMPLETED",
      },
    });
    const dependency = await prisma.invocationDependency.create({
      data: {
        id: randomUUID(),
        planId: seeded.planId,
        fromInvocationId: sourceInvocationId,
        toInvocationId: seeded.invocationId,
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

    const artifactService = new ArtifactService(prisma);
    const frozenReference = await artifactService.createArtifact({
      actorUserId: seeded.userId,
      creatorInvocationId: sourceInvocationId,
      outputName: "result",
      type: "TEXT",
      classification: "PRIVATE",
      content: {
        kind: "INLINE_JSON",
        value: { text: "frozen-version-one" },
      },
    });
    const latestReference = await artifactService.createVersion({
      actorUserId: seeded.userId,
      artifactId: frozenReference.artifactId,
      expectedCurrentVersion: frozenReference.version,
      content: {
        kind: "INLINE_JSON",
        value: { text: "newer-version-two" },
      },
    });
    expect(latestReference.version).toBe(2);

    const contextBundle: ContextBundleView = {
      id: "test-frozen-bundle",
      invocationId: seeded.invocationId,
      snapshotId: "test-snapshot",
      fingerprint: "sha256:test-frozen-bundle",
      manifest: {
        version: 1,
        packingVersion: 1,
        targetKind: "AI_MODEL",
        surfaceKind: "PERSONAL",
        surfaceScopeHash: "sha256:test-personal-surface",
        audienceParticipantCount: 1,
        budget: {
          contextWindowTokens: 16_384,
          outputReserveTokens: 4_096,
          systemToolReserveTokens: 2_048,
          artifactReserveTokens: 4_096,
          safetyMarginTokens: 1_310,
          effectiveHistoryBudgetTokens: 4_834,
          compactedStateTriggerTokens: 3_867,
        },
        usedTokens: 0,
        rawHistoryTokens: 0,
        compactedStateRequired: false,
        allowedItems: [],
        allowedArtifacts: [
          {
            inputName: "candidate",
            artifactId: frozenReference.artifactId,
            artifactVersionId: frozenReference.artifactVersionId,
            classification: "PRIVATE",
            version: frozenReference.version,
            fingerprint: frozenReference.fingerprint,
          },
        ],
        denials: [],
        packingExclusions: [],
        artifactDenials: [],
      },
      items: [],
      artifacts: [
        {
          inputName: "candidate",
          expectedType: "TEXT",
          dependencyId: dependency.id,
          sourceInvocationId,
          reference: frozenReference,
        },
      ],
      createdAt: new Date().toISOString(),
    };

    const provider = new MockAiProvider();
    const executor = createExecutor(prisma, provider);
    const result = await executor.execute({
      ...executionInput(seeded, {
        kind: "AI_MODEL",
        modelSlug: "gpt-5-6-luna",
        agentId: null,
      }),
      contextBundle,
    });

    expect(result).toEqual({ status: "COMPLETED", outcome: "PASS" });
    expect(provider.callCount).toBe(1);
    const providerContent = provider.lastRequest?.messages[0]?.content ?? "";
    expect(providerContent).toContain("frozen-version-one");
    expect(providerContent).not.toContain("newer-version-two");
  });

  it("passes only rendered authorized ContextBundle items to the external provider", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Use the authorized release context",
      fund: true,
    });
    const internalOwnerId = "internal-owner-" + randomUUID();
    const contextBundle: ContextBundleView = {
      id: "test-rendered-bundle",
      invocationId: seeded.invocationId,
      snapshotId: "test-rendered-snapshot",
      fingerprint: "sha256:test-rendered-bundle",
      manifest: {
        version: 1,
        packingVersion: 1,
        targetKind: "AI_MODEL",
        surfaceKind: "PERSONAL",
        surfaceScopeHash: "sha256:test-personal-surface",
        audienceParticipantCount: 1,
        budget: {
          contextWindowTokens: 16_384,
          outputReserveTokens: 4_096,
          systemToolReserveTokens: 2_048,
          artifactReserveTokens: 4_096,
          safetyMarginTokens: 1_310,
          effectiveHistoryBudgetTokens: 4_834,
          compactedStateTriggerTokens: 3_867,
        },
        usedTokens: 24,
        rawHistoryTokens: 24,
        compactedStateRequired: false,
        allowedItems: [
          {
            snapshotItemId: "context-item-1",
            sourceType: "MESSAGE",
            classification: "PRIVATE",
            fingerprint: "sha256:context-item-1",
            estimatedTokens: 24,
            selectionReason: "RELEVANT",
          },
        ],
        allowedArtifacts: [],
        denials: [],
        packingExclusions: [],
        artifactDenials: [],
      },
      items: [
        {
          id: "context-item-1",
          sequence: 0,
          sourceType: "MESSAGE",
          sourceId: "message-context-1",
          sourceVersion: "v1",
          classification: "PRIVATE",
          contentRef: "vimla://messages/message-context-1",
          metadata: {
            role: "ASSISTANT",
            content: "The Zephyr release decision is violet.",
            retrieval: {
              sourceKind: "CROSS_CONVERSATION",
              scope: {
                kind: "PERSONAL",
                ownerUserId: internalOwnerId,
              },
              reason: "same-user lexical retrieval",
              lexicalScore: 0.92,
            },
          },
          fingerprint: "sha256:context-item-1",
          createdAt: new Date().toISOString(),
        },
      ],
      artifacts: [],
      createdAt: new Date().toISOString(),
    };

    const provider = new MockAiProvider();
    const executor = createExecutor(prisma, provider);
    const result = await executor.execute({
      ...executionInput(seeded, {
        kind: "AI_MODEL",
        modelSlug: "gpt-5-6-luna",
        agentId: null,
      }),
      contextBundle,
    });

    expect(result).toEqual({ status: "COMPLETED", outcome: "PASS" });
    const providerContent = provider.lastRequest?.messages[0]?.content ?? "";
    expect(providerContent).toContain("PURPOSE:");
    expect(providerContent).toContain("CONTEXT_SAFETY:");
    expect(providerContent).toContain("AUTHORIZED_CONTEXT:");
    expect(providerContent).toContain(
      "The Zephyr release decision is violet.",
    );
    expect(providerContent).not.toContain(internalOwnerId);
    expect(providerContent).not.toContain("lexicalScore");
    expect(providerContent).not.toContain("same-user lexical retrieval");
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

  it("rejects in-place mutation of frozen AI price-version economics", async () => {
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
    if (!price) throw new Error("AI price version missing");

    await expect(
      prisma.aiModelPriceVersion.update({
        where: { id: price.id },
        data: {
          inputMicroRubPerMillion:
            price.inputMicroRubPerMillion + 1n,
        },
      }),
    ).rejects.toThrow(
      "ai_model_price_version commercial fields are immutable",
    );

    const unchanged = await prisma.aiModelPriceVersion.findUniqueOrThrow({
      where: { id: price.id },
    });
    expect(unchanged.inputMicroRubPerMillion).toBe(
      price.inputMicroRubPerMillion,
    );
  });

  it("reuses the frozen price version for a created turn after catalog pricing changes", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Resume an admitted turn using its frozen price version",
      fund: true,
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
    const frozenPrice = model.priceVersions[0];
    if (!frozenPrice) throw new Error("Frozen test price version missing");

    const aiRequest = await prisma.aiRequest.create({
      data: {
        userId: seeded.userId,
        conversationId: seeded.conversationId,
        modelId: model.id,
        priceVersionId: frozenPrice.id,
        clientRequestId: orchestrationAiClientRequestId(seeded.invocationId),
        provider: model.provider,
        providerModelId: model.providerModelId,
        status: "CREATED",
        financialStatus: "NONE",
        estimatedInputTokens: 5_000,
        maxOutputTokens: 768,
        estimatedCostMicroRub: 10_000_000n,
      },
    });
    const execution = await prisma.aIExecution.create({
      data: {
        invocationRunId: seeded.runId,
        aiRequestId: aiRequest.id,
      },
    });
    await prisma.aIProviderTurn.create({
      data: {
        aiExecutionId: execution.id,
        turnIndex: 0,
        aiRequestId: aiRequest.id,
        idempotencyKey: orchestrationAiProviderTurnIdempotencyKey(
          seeded.invocationId,
          0,
        ),
        status: "CREATED",
      },
    });

    const replacementPrice = await prisma.aiModelPriceVersion.create({
      data: {
        modelId: model.id,
        inputMicroRubPerMillion:
          frozenPrice.inputMicroRubPerMillion * 100n,
        outputMicroRubPerMillion:
          frozenPrice.outputMicroRubPerMillion * 100n,
        cacheReadMicroRubPerMillion:
          frozenPrice.cacheReadMicroRubPerMillion === null
            ? null
            : frozenPrice.cacheReadMicroRubPerMillion * 100n,
        cacheWriteMicroRubPerMillion:
          frozenPrice.cacheWriteMicroRubPerMillion === null
            ? null
            : frozenPrice.cacheWriteMicroRubPerMillion * 100n,
        effectiveFrom: new Date(),
        effectiveTo: null,
        verifiedAt: new Date(),
        source: "test-price-version-rollover",
      },
    });

    try {
      const provider = new MockAiProvider();
      const executor = createExecutor(prisma, provider);
      const result = await executor.execute(
        executionInput(seeded, {
          kind: "AI_MODEL",
          modelSlug: "gpt-5-6-luna",
          agentId: null,
        }),
      );

      expect(result).toEqual({ status: "COMPLETED", outcome: "PASS" });
      const after = await prisma.aiRequest.findUniqueOrThrow({
        where: { id: aiRequest.id },
      });
      const frozenQuote = {
        inputMicroRubPerMillion: frozenPrice.inputMicroRubPerMillion,
        outputMicroRubPerMillion: frozenPrice.outputMicroRubPerMillion,
        cacheReadMicroRubPerMillion:
          frozenPrice.cacheReadMicroRubPerMillion,
        cacheWriteMicroRubPerMillion:
          frozenPrice.cacheWriteMicroRubPerMillion,
      };
      const replacementQuote = {
        inputMicroRubPerMillion:
          replacementPrice.inputMicroRubPerMillion,
        outputMicroRubPerMillion:
          replacementPrice.outputMicroRubPerMillion,
        cacheReadMicroRubPerMillion:
          replacementPrice.cacheReadMicroRubPerMillion,
        cacheWriteMicroRubPerMillion:
          replacementPrice.cacheWriteMicroRubPerMillion,
      };
      expect(after.priceVersionId).toBe(frozenPrice.id);
      expect(after.providerActualCostMicroRub).toBe(
        providerCostFromUsage(provider.usage, frozenQuote),
      );
      expect(after.providerActualCostMicroRub).not.toBe(
        providerCostFromUsage(provider.usage, replacementQuote),
      );
      expect(provider.callCount).toBe(1);
    } finally {
      await prisma.aiModelPriceVersion.delete({
        where: { id: replacementPrice.id },
      });
    }
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
      fundMicroRub: 1_400_000n,
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
    expect(request.estimatedCostMicroRub).toBeLessThanOrEqual(1_400_000n);
    expect(request.reservation?.estimatedMicroRub).toBe(request.estimatedCostMicroRub);
    expect(provider.lastRequest?.maxOutputTokens).toBe(request.maxOutputTokens);
  });

  it("shrinks the funded provider cap to the remaining model context window", async () => {
    const model = await prisma.aiModel.findUniqueOrThrow({
      where: { slug: "gpt-5-6-luna" },
      select: { id: true, contextWindowTokens: true },
    });
    const contextWindowTokens = 6_200;
    await prisma.aiModel.update({
      where: { id: model.id },
      data: { contextWindowTokens },
    });

    try {
      const seeded = await seedInvocation(prisma, {
        targetKind: "AI_MODEL",
        targetModelSlug: "gpt-5-6-luna",
        purpose: "Fit this answer inside the remaining context window",
        fund: true,
      });
      const provider = new MockAiProvider();
      const executor = createExecutor(prisma, provider);

      const result = await executor.execute(
        executionInput(seeded, {
          kind: "AI_MODEL",
          modelSlug: "gpt-5-6-luna",
          agentId: null,
        }),
      );

      expect(result).toEqual({ status: "COMPLETED", outcome: "PASS" });
      const request = await prisma.aiRequest.findUniqueOrThrow({
        where: {
          userId_clientRequestId: {
            userId: seeded.userId,
            clientRequestId: orchestrationAiClientRequestId(seeded.invocationId),
          },
        },
      });
      expect(request.maxOutputTokens).toBeLessThan(2_048);
      expect(request.maxOutputTokens).toBeGreaterThanOrEqual(768);
      expect(
        request.estimatedInputTokens + request.maxOutputTokens,
      ).toBeLessThanOrEqual(contextWindowTokens);
      expect(provider.lastRequest?.maxOutputTokens).toBe(
        request.maxOutputTokens,
      );
    } finally {
      await prisma.aiModel.update({
        where: { id: model.id },
        data: { contextWindowTokens: model.contextWindowTokens },
      });
    }
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

  it("does not let AI_AUTO choose an incapable model merely because it is cheaper", async () => {
    const gemini = await prisma.aiModel.findUniqueOrThrow({
      where: { slug: "gemini-3-5-flash-lite" },
      include: { priceVersions: { orderBy: { effectiveFrom: "desc" } } },
    });
    const price = gemini.priceVersions[0];
    if (!price) throw new Error("Gemini price version missing");
    const cheapPrice = await prisma.aiModelPriceVersion.create({
      data: {
        modelId: gemini.id,
        inputMicroRubPerMillion: 1n,
        outputMicroRubPerMillion: 1n,
        cacheReadMicroRubPerMillion: price.cacheReadMicroRubPerMillion,
        cacheWriteMicroRubPerMillion: price.cacheWriteMicroRubPerMillion,
        effectiveFrom: new Date(),
        effectiveTo: null,
        verifiedAt: new Date(),
        source: "test-cheap-incapable-model",
      },
    });

    try {
      const seeded = await seedInvocation(prisma, {
        targetKind: "AI_AUTO",
        targetModelSlug: null,
        purpose: "Use an authorized repository tool if needed",
        fund: true,
      });
      const provider = new MockAiProvider();
      const tools = new TestToolBroker("repository context");
      const executor = createExecutor(prisma, provider, tools);

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
      expect(request.model.slug).not.toBe("gemini-3-5-flash-lite");
      expect(provider.callCount).toBe(1);
    } finally {
      await prisma.aiModelPriceVersion.delete({
        where: { id: cheapPrice.id },
      });
    }
  });

  it("lets AI_AUTO skip a preferred model that cannot fund its minimum turn", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_AUTO",
      targetModelSlug: null,
      purpose: "Write a concise funded answer",
      fund: true,
      fundMicroRub: 2_500_000n,
    });
    const provider = new MockAiProvider();
    const executor = createExecutor(prisma, provider);

    const result = await executor.execute(
      executionInput(seeded, {
        kind: "AI_AUTO",
        modelSlug: null,
        agentId: null,
      }),
    );

    expect(result).toEqual({ status: "COMPLETED", outcome: "PASS" });
    const request = await prisma.aiRequest.findUniqueOrThrow({
      where: {
        userId_clientRequestId: {
          userId: seeded.userId,
          clientRequestId: orchestrationAiClientRequestId(seeded.invocationId),
        },
      },
      include: { model: true },
    });
    expect(request.model.slug).toBe("gpt-5-6-luna");
    expect(provider.callCount).toBe(1);
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

  it("releases a reservation after a proven safe provider rejection", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Safe provider rejection",
      fund: true,
    });
    const provider = new MockAiProvider();
    provider.scenario = "reject";
    const executor = createExecutor(prisma, provider);

    const result = await executor.execute(
      executionInput(seeded, {
        kind: "AI_MODEL",
        modelSlug: "gpt-5-6-luna",
        agentId: null,
      }),
    );

    expect(result).toEqual({
      status: "FAILED",
      errorCode: "AI_PROVIDER_REJECTED",
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
    expect(request.financialStatus).toBe("RELEASED");
    expect(request.reservation?.status).toBe("RELEASED");
    expect(request.providerTurn?.status).toBe("FAILED_SAFE_PROVIDER");
    expect(await spentForUser(prisma, seeded.userId)).toBe(0n);
  });

  it("releases a reservation after a proven provider balance rejection", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Provider balance rejection",
      fund: true,
    });
    const provider = new MockAiProvider();
    provider.scenario = "balance";
    const executor = createExecutor(prisma, provider);

    const result = await executor.execute(
      executionInput(seeded, {
        kind: "AI_MODEL",
        modelSlug: "gpt-5-6-luna",
        agentId: null,
      }),
    );

    expect(result).toEqual({
      status: "FAILED",
      errorCode: "AI_PROVIDER_BALANCE",
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
    expect(request.financialStatus).toBe("RELEASED");
    expect(request.reservation?.status).toBe("RELEASED");
    expect(await spentForUser(prisma, seeded.userId)).toBe(0n);
  });

  it("holds a stream with missing terminal usage instead of releasing or retrying it", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Missing terminal usage",
      fund: true,
    });
    const provider = new MockAiProvider();
    provider.scenario = "missing-usage";
    const executor = createExecutor(prisma, provider);

    const result = await executor.execute(
      executionInput(seeded, {
        kind: "AI_MODEL",
        modelSlug: "gpt-5-6-luna",
        agentId: null,
      }),
    );

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
      include: { reservation: true, providerTurn: true },
    });
    expect(request.financialStatus).toBe("RECONCILIATION_HOLD");
    expect(request.reservation?.status).toBe("ACTIVE");
    expect(request.providerTurn?.status).toBe("RECONCILIATION_REQUIRED");
    expect(await spentForUser(prisma, seeded.userId)).toBe(0n);
  });

  it("holds impossible provider usage instead of silently settling it", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Invalid provider usage",
      fund: true,
    });
    const provider = new MockAiProvider();
    provider.usage = {
      inputTokens: 10n,
      outputTokens: 1n,
      reasoningTokens: 0n,
      cacheReadTokens: 11n,
      cacheWriteTokens: 0n,
    };
    const executor = createExecutor(prisma, provider);

    const result = await executor.execute(
      executionInput(seeded, {
        kind: "AI_MODEL",
        modelSlug: "gpt-5-6-luna",
        agentId: null,
      }),
    );

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
      include: { reservation: true, providerTurn: true },
    });
    expect(request.financialStatus).toBe("RECONCILIATION_HOLD");
    expect(request.reservation?.status).toBe("ACTIVE");
    expect(request.providerTurn?.status).toBe("RECONCILIATION_REQUIRED");
    expect(await spentForUser(prisma, seeded.userId)).toBe(0n);
  });

  it("settles malformed streamed tool-call usage but fails the semantic turn", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Malformed streamed tool call",
      fund: true,
    });
    const provider = new InvalidToolCallProvider();
    const executor = createExecutor(prisma, provider);

    const result = await executor.execute(
      executionInput(seeded, {
        kind: "AI_MODEL",
        modelSlug: "gpt-5-6-luna",
        agentId: null,
      }),
    );

    expect(result).toEqual({
      status: "FAILED",
      errorCode: "AI_TOOL_CALL_INVALID",
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
    expect(request.status).toBe("FAILED");
    expect(request.financialStatus).toBe("SETTLED");
    expect(request.reservation?.status).toBe("SETTLED");
    expect(request.providerTurn?.status).toBe("SUCCEEDED");
    expect(request.providerTurn?.toolCallError).toBe(true);
    expect(request.userSettledUsageMicroRub).toBeGreaterThan(0n);
    expect(
      await prisma.artifact.count({
        where: { creatorInvocationId: seeded.invocationId },
      }),
    ).toBe(0);
  });

  it("funds tool definitions as part of the provider input before any call", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Use the authorized repository tool",
      fund: true,
      fundMicroRub: 2_000_000n,
    });
    const provider = new MockAiProvider();
    const tools = new TestToolBroker(
      "small result",
      "x".repeat(20_000),
    );
    const executor = createExecutor(prisma, provider, tools);

    const result = await executor.execute(
      executionInput(seeded, {
        kind: "AI_MODEL",
        modelSlug: "gpt-5-6-luna",
        agentId: null,
      }),
    );

    expect(result).toEqual({
      status: "BLOCKED_INSUFFICIENT_USAGE",
      errorCode: "BILLING_INSUFFICIENT_USAGE",
    });
    expect(provider.callCount).toBe(0);
    expect(
      await prisma.aiRequest.count({ where: { userId: seeded.userId } }),
    ).toBe(0);
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

  it("persists a reservation-race usage pause and resumes the same provider turn", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Resume after losing the reservation race",
      fund: true,
    });
    const provider = new MockAiProvider();
    const raceBilling = new FailFirstReservationBillingEngine(
      prisma,
      billingPolicy,
    );
    const executor = createExecutor(
      prisma,
      provider,
      undefined,
      {},
      raceBilling,
    );

    const first = await executor.execute(
      executionInput(seeded, {
        kind: "AI_MODEL",
        modelSlug: "gpt-5-6-luna",
        agentId: null,
      }),
    );
    expect(first).toEqual({
      status: "BLOCKED_INSUFFICIENT_USAGE",
      errorCode: "BILLING_INSUFFICIENT_USAGE",
    });
    expect(provider.callCount).toBe(0);

    const pausedTurn = await prisma.aIProviderTurn.findUniqueOrThrow({
      where: {
        idempotencyKey: orchestrationAiProviderTurnIdempotencyKey(
          seeded.invocationId,
          0,
        ),
      },
      include: { aiRequest: true },
    });
    expect(pausedTurn.status).toBe("BLOCKED_INSUFFICIENT_USAGE");
    expect(pausedTurn.aiRequest.status).toBe("CREATED");
    expect(pausedTurn.aiRequest.financialStatus).toBe("NONE");

    const resumed = await executor.execute(
      executionInput(seeded, {
        kind: "AI_MODEL",
        modelSlug: "gpt-5-6-luna",
        agentId: null,
      }),
    );
    expect(resumed).toEqual({ status: "COMPLETED", outcome: "PASS" });
    expect(provider.callCount).toBe(1);
    expect(
      await prisma.aIProviderTurn.count({
        where: {
          aiExecution: {
            invocationRun: { invocationId: seeded.invocationId },
          },
        },
      }),
    ).toBe(1);
  });

  it("rechecks the plan committed ceiling before resuming a paused provider turn", async () => {
    const maxCommitted = 5_000_000n;
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Pause before another branch consumes plan budget",
      fund: true,
    });
    const provider = new MockAiProvider();
    const raceBilling = new FailFirstReservationBillingEngine(
      prisma,
      billingPolicy,
    );
    const executor = createExecutor(
      prisma,
      provider,
      undefined,
      {
        maxSettledCostMicroRubPerPlan: maxCommitted,
        maxCommittedCostMicroRubPerPlan: maxCommitted,
      },
      raceBilling,
    );

    const paused = await executor.execute(
      executionInput(seeded, {
        kind: "AI_MODEL",
        modelSlug: "gpt-5-6-luna",
        agentId: null,
      }),
    );
    expect(paused.status).toBe("BLOCKED_INSUFFICIENT_USAGE");

    const firstTurn = await prisma.aIProviderTurn.findUniqueOrThrow({
      where: {
        idempotencyKey: orchestrationAiProviderTurnIdempotencyKey(
          seeded.invocationId,
          0,
        ),
      },
      include: { aiRequest: true },
    });
    const filler = maxCommitted - firstTurn.aiRequest.estimatedCostMicroRub + 1n;
    expect(filler).toBeGreaterThan(0n);

    const sibling = await seedSiblingInvocation(prisma, seeded);
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
    if (!price) throw new Error("Sibling price version missing");
    const siblingRequest = await prisma.aiRequest.create({
      data: {
        userId: sibling.userId,
        conversationId: sibling.conversationId,
        modelId: model.id,
        priceVersionId: price.id,
        clientRequestId: `plan-cap-filler:${randomUUID()}`,
        provider: model.provider,
        providerModelId: model.providerModelId,
        status: "CREATED",
        financialStatus: "NONE",
        estimatedInputTokens: 1,
        maxOutputTokens: 1,
        estimatedCostMicroRub: filler,
      },
    });
    const reservation = await raceBilling.reserveUsage({
      userId: sibling.userId,
      requestId: siblingRequest.id,
      estimatedProviderCostMicroRub: filler,
    });
    await prisma.aiRequest.update({
      where: { id: siblingRequest.id },
      data: {
        reservationId: reservation.id,
        status: "RESERVED",
        financialStatus: "RESERVED",
      },
    });
    const siblingExecution = await prisma.aIExecution.create({
      data: {
        invocationRunId: sibling.runId,
        aiRequestId: siblingRequest.id,
      },
    });
    await prisma.aIProviderTurn.create({
      data: {
        aiExecutionId: siblingExecution.id,
        turnIndex: 0,
        aiRequestId: siblingRequest.id,
        idempotencyKey: orchestrationAiProviderTurnIdempotencyKey(
          sibling.invocationId,
          0,
        ),
        status: "RESERVED",
      },
    });

    const resumed = await executor.execute(
      executionInput(seeded, {
        kind: "AI_MODEL",
        modelSlug: "gpt-5-6-luna",
        agentId: null,
      }),
    );
    expect(resumed).toEqual({
      status: "FAILED",
      errorCode: "PLAN_SPEND_LIMIT_REACHED",
      retryable: false,
    });
    expect(provider.callCount).toBe(0);
  });

  it("waits when allowance is temporarily held by another reservation and resumes after release", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Wait for temporary usage capacity",
      fund: true,
      fundMicroRub: 2_000_000n,
    });
    const billing = new BillingEngine(prisma, billingPolicy);
    const competing = await billing.reserveUsage({
      userId: seeded.userId,
      requestId: randomUUID(),
      estimatedProviderCostMicroRub: 1_000_000n,
    });
    const provider = new MockAiProvider();
    const executor = createExecutor(prisma, provider);

    const waiting = await executor.execute(executionInput(seeded, {
      kind: "AI_MODEL",
      modelSlug: "gpt-5-6-luna",
      agentId: null,
    }));
    expect(waiting).toEqual({
      status: "WAITING_FOR_USAGE_CAPACITY",
      errorCode: "BILLING_INSUFFICIENT_USAGE",
    });
    expect(provider.callCount).toBe(0);

    await billing.releaseUsage({
      userId: seeded.userId,
      reservationId: competing.id,
    });
    const resumed = await executor.execute(executionInput(seeded, {
      kind: "AI_MODEL",
      modelSlug: "gpt-5-6-luna",
      agentId: null,
    }));
    expect(resumed).toEqual({ status: "COMPLETED", outcome: "PASS" });
    expect(provider.callCount).toBe(1);
  });

  it("turns a capacity wait into a hard usage block when competing work settles the allowance", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Become blocked after competing work settles",
      fund: true,
      fundMicroRub: 2_000_000n,
    });
    const billing = new BillingEngine(prisma, billingPolicy);
    const competing = await billing.reserveUsage({
      userId: seeded.userId,
      requestId: randomUUID(),
      estimatedProviderCostMicroRub: 1_000_000n,
    });
    const provider = new MockAiProvider();
    const executor = createExecutor(prisma, provider);

    const waiting = await executor.execute(executionInput(seeded, {
      kind: "AI_MODEL",
      modelSlug: "gpt-5-6-luna",
      agentId: null,
    }));
    expect(waiting.status).toBe("WAITING_FOR_USAGE_CAPACITY");

    await billing.settleUsage({
      userId: seeded.userId,
      reservationId: competing.id,
      actualMicroRub: 1_000_000n,
    });
    const blocked = await executor.execute(executionInput(seeded, {
      kind: "AI_MODEL",
      modelSlug: "gpt-5-6-luna",
      agentId: null,
    }));
    expect(blocked).toEqual({
      status: "BLOCKED_INSUFFICIENT_USAGE",
      errorCode: "BILLING_INSUFFICIENT_USAGE",
    });
    expect(provider.callCount).toBe(0);
  });

  it("stops before another paid provider turn when the per-invocation turn ceiling is reached", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Use one provider turn only",
      fund: true,
    });
    const provider = new MockAiProvider();
    provider.toolCallQueue.push([
      {
        id: "call-once",
        name: "github.readFile",
        arguments: { path: "README.md" },
      },
    ]);
    const tools = new TestToolBroker("small tool result");
    const executor = createExecutor(prisma, provider, tools, {
      maxProviderTurnsPerInvocation: 1,
    });

    const result = await executor.execute(executionInput(seeded, {
      kind: "AI_MODEL",
      modelSlug: "gpt-5-6-luna",
      agentId: null,
    }));

    expect(result).toEqual({
      status: "FAILED",
      errorCode: "PLAN_SPEND_LIMIT_REACHED",
      retryable: false,
    });
    expect(provider.callCount).toBe(1);
    expect(tools.calls).toHaveLength(1);
    const turns = await prisma.aIProviderTurn.findMany({
      where: {
        aiExecution: {
          invocationRun: { invocationId: seeded.invocationId },
        },
      },
      include: { aiRequest: { include: { reservation: true } } },
    });
    expect(turns).toHaveLength(1);
    expect(turns[0]?.aiRequest.reservation?.status).toBe("SETTLED");
  });

  it("enforces the max paid invocations ceiling across a plan", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "First paid invocation",
      fund: true,
    });
    const provider = new MockAiProvider();
    const executor = createExecutor(prisma, provider, undefined, {
      maxPaidInvocationsPerPlan: 1,
    });

    const first = await executor.execute(executionInput(seeded, {
      kind: "AI_MODEL",
      modelSlug: "gpt-5-6-luna",
      agentId: null,
    }));
    expect(first.status).toBe("COMPLETED");

    const sibling = await seedSiblingInvocation(prisma, seeded);
    const second = await executor.execute(executionInput(sibling, {
      kind: "AI_MODEL",
      modelSlug: "gpt-5-6-luna",
      agentId: null,
    }));
    expect(second).toEqual({
      status: "FAILED",
      errorCode: "PLAN_SPEND_LIMIT_REACHED",
      retryable: false,
    });
    expect(provider.callCount).toBe(1);
  });

  it("enforces the cumulative plan spend ceiling before any uncovered provider call", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "This user can afford the request but the plan ceiling cannot",
      fund: true,
      fundMicroRub: 10_000_000n,
    });
    const provider = new MockAiProvider();
    const executor = createExecutor(prisma, provider, undefined, {
      maxSettledCostMicroRubPerPlan: 300_000n,
      maxCommittedCostMicroRubPerPlan: 300_000n,
    });

    const result = await executor.execute(executionInput(seeded, {
      kind: "AI_MODEL",
      modelSlug: "gpt-5-6-luna",
      agentId: null,
    }));

    expect(result).toEqual({
      status: "FAILED",
      errorCode: "PLAN_SPEND_LIMIT_REACHED",
      retryable: false,
    });
    expect(provider.callCount).toBe(0);
    expect(
      await prisma.usageReservation.count({ where: { userId: seeded.userId } }),
    ).toBe(0);
  });

  it("serializes parallel plan-spend admission so pending turns cannot exceed the committed ceiling", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Parallel paid invocation A",
      fund: true,
      fundMicroRub: 20_000_000n,
    });
    const sibling = await seedSiblingInvocation(prisma, seeded);
    const provider = new MockAiProvider();
    const delayedBilling = new DelayedFirstReservationBillingEngine(
      prisma,
      billingPolicy,
    );
    const executor = createExecutor(
      prisma,
      provider,
      undefined,
      {
        maxSettledCostMicroRubPerPlan: 2_000_000n,
        maxCommittedCostMicroRubPerPlan: 2_000_000n,
      },
      delayedBilling,
    );

    const [left, right] = await Promise.all([
      executor.execute(
        executionInput(seeded, {
          kind: "AI_MODEL",
          modelSlug: "gpt-5-6-luna",
          agentId: null,
        }),
      ),
      executor.execute(
        executionInput(sibling, {
          kind: "AI_MODEL",
          modelSlug: "gpt-5-6-luna",
          agentId: null,
        }),
      ),
    ]);

    const results = [left, right];
    expect(
      results.filter((result) => result.status === "COMPLETED"),
    ).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          result.status === "FAILED" &&
          result.errorCode === "PLAN_SPEND_LIMIT_REACHED",
      ),
    ).toHaveLength(1);
    expect(provider.callCount).toBe(1);

    const turns = await prisma.aIProviderTurn.findMany({
      where: {
        aiExecution: {
          invocationRun: {
            invocation: { planId: seeded.planId },
          },
        },
      },
    });
    expect(turns).toHaveLength(1);
  });

  it("releases a funded reservation when Stop wins before the provider boundary", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Cancel before provider",
      fund: true,
    });
    await prisma.invocation.update({
      where: { id: seeded.invocationId },
      data: { status: "CANCELED" },
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
      errorCode: "AI_EXECUTION_CANCELED",
      retryable: false,
    });
    expect(provider.callCount).toBe(0);
    const request = await prisma.aiRequest.findUniqueOrThrow({
      where: {
        userId_clientRequestId: {
          userId: seeded.userId,
          clientRequestId: orchestrationAiClientRequestId(seeded.invocationId),
        },
      },
      include: { reservation: true },
    });
    expect(request.financialStatus).toBe("RELEASED");
    expect(request.reservation?.status).toBe("RELEASED");
    const bucket = await prisma.usageBucket.findFirstOrThrow({
      where: { userId: seeded.userId },
    });
    expect(bucket.spentMicroRub).toBe(0n);
    expect(bucket.reservedMicroRub).toBe(0n);
  });

  it("holds an in-flight Stop for reconciliation when provider usage is ambiguous", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Cancel an ambiguous in-flight provider request",
      fund: true,
    });
    const provider = new MockAiProvider();
    provider.delayMs = 5_000;
    const executor = createExecutor(prisma, provider, undefined, {
      cancellationPollMs: 10,
    });

    const execution = executor.execute(executionInput(seeded, {
      kind: "AI_MODEL",
      modelSlug: "gpt-5-6-luna",
      agentId: null,
    }));
    await waitForAiRequestStatus(prisma, seeded.userId, "PROVIDER_STARTED");
    await prisma.invocation.update({
      where: { id: seeded.invocationId },
      data: { status: "CANCELED" },
    });
    const result = await execution;

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
    expect(request.financialStatus).toBe("RECONCILIATION_HOLD");
    expect(request.reservation?.status).toBe("ACTIVE");
  });

  it("settles known provider usage when Stop arrives in flight and does not emit an artifact", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Settle known usage on Stop",
      fund: true,
    });
    const provider = new KnownUsageAbortProvider();
    const executor = createExecutor(prisma, provider, undefined, {
      cancellationPollMs: 10,
    });

    const execution = executor.execute(executionInput(seeded, {
      kind: "AI_MODEL",
      modelSlug: "gpt-5-6-luna",
      agentId: null,
    }));
    await waitForAiRequestStatus(prisma, seeded.userId, "STREAMING");
    await prisma.invocation.update({
      where: { id: seeded.invocationId },
      data: { status: "CANCELED" },
    });
    const result = await execution;

    expect(result).toEqual({
      status: "FAILED",
      errorCode: "AI_EXECUTION_CANCELED",
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
    expect(request.status).toBe("FAILED");
    expect(request.financialStatus).toBe("SETTLED");
    expect(request.reservation?.status).toBe("SETTLED");
    expect(request.providerTurn?.providerInterrupted).toBe(true);
    expect(request.userSettledUsageMicroRub).toBeGreaterThan(0n);
    expect(
      await prisma.artifact.count({
        where: { creatorInvocationId: seeded.invocationId },
      }),
    ).toBe(0);
  });

  it("does not mutate settled finance when Stop happens after provider settlement", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Complete before Stop",
      fund: true,
    });
    const provider = new MockAiProvider();
    const executor = createExecutor(prisma, provider);

    expect(
      await executor.execute(executionInput(seeded, {
        kind: "AI_MODEL",
        modelSlug: "gpt-5-6-luna",
        agentId: null,
      })),
    ).toEqual({ status: "COMPLETED", outcome: "PASS" });
    const before = await prisma.aiRequest.findUniqueOrThrow({
      where: {
        userId_clientRequestId: {
          userId: seeded.userId,
          clientRequestId: orchestrationAiClientRequestId(seeded.invocationId),
        },
      },
      include: { reservation: true },
    });

    await prisma.invocation.update({
      where: { id: seeded.invocationId },
      data: { status: "CANCELED" },
    });
    const after = await prisma.aiRequest.findUniqueOrThrow({
      where: { id: before.id },
      include: { reservation: true },
    });

    expect(after.financialStatus).toBe("SETTLED");
    expect(after.userSettledUsageMicroRub).toBe(before.userSettledUsageMicroRub);
    expect(after.reservation?.status).toBe("SETTLED");
    expect(after.reservation?.settledMicroRub).toBe(
      before.reservation?.settledMicroRub,
    );
  });

  it("funds each tool-loop turn independently and resumes after top-up without replaying paid work", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Read the repository file and summarize it",
      fund: true,
      fundMicroRub: 1_500_000n,
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
    // Keep the second turn below the per-request hard cap while making its
    // minimum funded budget exceed the allowance left after turn 0. This
    // isolates usage backpressure/top-up resume from request-cost-limit logic.
    const tools = new TestToolBroker("x".repeat(1_000));
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

  it("holds a mid-stream disconnect after partial provider output when usage is unknown", async () => {
    const seeded = await seedInvocation(prisma, {
      targetKind: "AI_MODEL",
      targetModelSlug: "gpt-5-6-luna",
      purpose: "Handle a partial stream disconnect safely",
      fund: true,
    });
    const provider = new MidstreamDisconnectProvider();
    const executor = createExecutor(prisma, provider);

    const result = await executor.execute(
      executionInput(seeded, {
        kind: "AI_MODEL",
        modelSlug: "gpt-5-6-luna",
        agentId: null,
      }),
    );

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
      include: { reservation: true, providerTurn: true },
    });
    expect(request.outputText).toBe("partial");
    expect(request.financialStatus).toBe("RECONCILIATION_HOLD");
    expect(request.reservation?.status).toBe("ACTIVE");
    expect(request.providerTurn?.status).toBe("RECONCILIATION_REQUIRED");
    expect(await spentForUser(prisma, seeded.userId)).toBe(0n);
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

function recordingTelemetry(): {
  events: TelemetryEvent[];
  sink: TelemetrySink;
} {
  const events: TelemetryEvent[] = [];
  return {
    events,
    sink: {
      emit: (event) => {
        events.push(event);
      },
    },
  };
}

function createExecutor(
  prisma: PrismaClient,
  provider: AiProvider,
  toolBroker?: ExternalAiToolBroker,
  overrides: Partial<ExternalAiExecutorConfig> = {},
  billingOverride?: BillingEngine,
  telemetry?: TelemetrySink,
): ExternalAiInvocationExecutor {
  return new ExternalAiInvocationExecutor(
    prisma,
    billingOverride ?? new BillingEngine(prisma, billingPolicy),
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
    undefined,
    telemetry,
  );
}

type SeededInvocation = {
  userId: string;
  conversationId: string;
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
    conversationId,
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

async function spentForUser(
  prisma: PrismaClient,
  userId: string,
): Promise<bigint> {
  const buckets = await prisma.usageBucket.findMany({ where: { userId } });
  return buckets.reduce((sum, bucket) => sum + bucket.spentMicroRub, 0n);
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


class MidstreamDisconnectProvider implements AiProvider {
  readonly id = "mock";

  async streamChat(_request: ProviderChatRequest): Promise<ProviderChatResult> {
    return {
      providerRequestId: "midstream-disconnect",
      events: (async function* (): AsyncIterable<ProviderStreamEvent> {
        yield { type: "delta", text: "partial" };
        throw new ProviderCallError(
          "ambiguous",
          "Mock stream disconnected after partial output",
          null,
        );
      })(),
    };
  }
}

class InvalidToolCallProvider implements AiProvider {
  readonly id = "mock";

  async streamChat(_request: ProviderChatRequest): Promise<ProviderChatResult> {
    return {
      providerRequestId: "invalid-tool-call",
      events: (async function* (): AsyncIterable<ProviderStreamEvent> {
        yield {
          type: "tool_call_delta",
          index: 0,
          id: "call-invalid",
          argumentsDelta: "{}",
        };
        yield {
          type: "usage",
          usage: {
            inputTokens: 32n,
            outputTokens: 4n,
            reasoningTokens: 0n,
            cacheReadTokens: 0n,
            cacheWriteTokens: 0n,
          },
        };
        yield { type: "done" };
      })(),
    };
  }
}

class KnownUsageAbortProvider implements AiProvider {
  readonly id = "mock";

  async streamChat(request: ProviderChatRequest): Promise<ProviderChatResult> {
    const signal = request.abortSignal;
    return {
      providerRequestId: "known-usage-abort",
      events: (async function* (): AsyncIterable<ProviderStreamEvent> {
        yield { type: "delta", text: "partial" };
        yield {
          type: "usage",
          usage: {
            inputTokens: 18n,
            outputTokens: 8n,
            reasoningTokens: 0n,
            cacheReadTokens: 0n,
            cacheWriteTokens: 0n,
          },
        };
        await waitForAbort(signal);
        throw new DOMException("Provider stream aborted", "AbortError");
      })(),
    };
  }
}

async function waitForAbort(signal?: AbortSignal): Promise<void> {
  if (!signal) {
    throw new Error("AbortSignal is required for this fixture");
  }
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

async function waitForAiRequestStatus(
  prisma: PrismaClient,
  userId: string,
  status: string,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const request = await prisma.aiRequest.findFirst({
      where: { userId },
      select: { status: true },
      orderBy: { createdAt: "desc" },
    });
    if (request?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for AiRequest status ${status}`);
}

class TestToolBroker implements ExternalAiToolBroker {
  readonly calls: Array<{ name: string; idempotencyKey: string }> = [];

  constructor(
    private readonly fileContent: string,
    private readonly description = "Read an authorized repository file",
  ) {}

  async listTools() {
    return [
      {
        name: "github.readFile",
        description: this.description,
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


class FailFirstReservationBillingEngine extends BillingEngine {
  private failed = false;

  override async reserveUsage(
    input: Parameters<BillingEngine["reserveUsage"]>[0],
  ) {
    if (!this.failed) {
      this.failed = true;
      throw new BillingError(
        "INSUFFICIENT_USAGE",
        "Simulated reservation race loss",
      );
    }
    return super.reserveUsage(input);
  }
}

class DelayedFirstReservationBillingEngine extends BillingEngine {
  private reserveCalls = 0;

  override async reserveUsage(
    input: Parameters<BillingEngine["reserveUsage"]>[0],
  ) {
    this.reserveCalls += 1;
    if (this.reserveCalls === 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return super.reserveUsage(input);
  }
}
