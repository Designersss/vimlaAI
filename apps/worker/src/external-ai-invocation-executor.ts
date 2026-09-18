import {
  ArtifactError,
  ArtifactBindingError,
  ArtifactService,
  ArtifactValidationError,
  type ArtifactType,
} from "@vimla/artifacts";
import {
  estimateInputTokens,
  estimateReservationMicroRub,
  providerCostFromUsage,
  ProviderCallError,
  VIMLA_AI_MODEL_CATALOG,
  type NormalizedUsage,
  type PriceVersionQuote,
  type ProviderBillingBoundedness,
  type ProviderChatMessage,
  type ProviderToolCall,
  type ProviderToolDefinition,
  type VimlaAiGateway,
} from "@vimla/ai";
import {
  isBillingError,
  type BillingEngine,
} from "@vimla/billing";
import { type Prisma, type PrismaClient } from "@vimla/database";
import {
  resolveAiExecutionBudget,
  validateAiExecutionBudgetProfiles,
  type AiExecutionBudgetProfiles,
} from "./ai-execution-budget.js";
import {
  NoopExternalAiToolBroker,
  type ExternalAiToolBroker,
} from "./external-ai-tool-broker.js";
import type {
  InvocationExecutionInput,
  InvocationExecutionResult,
  InvocationExecutorRegistry,
} from "./orchestration.js";

const SUPPORTED_TEXT_OUTPUT_TYPES = new Set<ArtifactType>([
  "TEXT",
  "PROMPT",
  "DOCUMENT",
  "CODE",
  "PLAN",
  "PATCH",
]);

const IN_PROGRESS_AI_STATUSES = new Set([
  "CREATED",
  "RESERVED",
  "PROVIDER_STARTED",
  "STREAMING",
]);

export interface ExternalAiExecutorConfig {
  budgetProfiles: AiExecutionBudgetProfiles;
  reservationSafetyBps: bigint;
  maxReservationMicroRub: bigint;
  maxProviderTurnsPerInvocation?: number;
  maxPaidInvocationsPerPlan?: number;
  maxSettledCostMicroRubPerPlan?: bigint;
  maxCommittedCostMicroRubPerPlan?: bigint;
  cancellationPollMs?: number;
}

type ResolvedModel = {
  id: string;
  slug: string;
  provider: string;
  providerModelId: string;
  contextWindowTokens: number;
  maxOutputTokens: number;
  priceVersionId: string;
  billingBoundedness: ProviderBillingBoundedness;
  supportsToolUse: boolean;
  autoPriority: number;
  price: PriceVersionQuote;
};

type InvocationRecord = {
  purpose: string;
  targetKind: string;
  targetModelSlug: string | null;
  outputDeclarations: Prisma.JsonValue;
  plan: {
    userId: string;
    conversationId: string;
  };
};

export class ExternalAiAwareInvocationExecutorRegistry implements InvocationExecutorRegistry {
  constructor(
    private readonly ai: ExternalAiInvocationExecutor,
    private readonly fallback: InvocationExecutorRegistry,
  ) {}

  execute(input: InvocationExecutionInput): Promise<InvocationExecutionResult> {
    return input.target.kind === "AI_AUTO" || input.target.kind === "AI_MODEL"
      ? this.ai.execute(input)
      : this.fallback.execute(input);
  }
}

export class ExternalAiInvocationExecutor implements InvocationExecutorRegistry {
  private readonly artifacts: ArtifactService;
  private readonly maxProviderTurnsPerInvocation: number;
  private readonly maxPaidInvocationsPerPlan: number;
  private readonly maxSettledCostMicroRubPerPlan: bigint;
  private readonly maxCommittedCostMicroRubPerPlan: bigint;
  private readonly cancellationPollMs: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly billing: BillingEngine,
    private readonly gateway: VimlaAiGateway,
    private readonly config: ExternalAiExecutorConfig,
    private readonly toolBroker: ExternalAiToolBroker = new NoopExternalAiToolBroker(),
  ) {
    validateAiExecutionBudgetProfiles(config.budgetProfiles);
    if (config.maxReservationMicroRub <= 0n) {
      throw new Error("maxReservationMicroRub must be positive");
    }
    if (config.reservationSafetyBps < 0n) {
      throw new Error("reservationSafetyBps must be non-negative");
    }
    this.maxProviderTurnsPerInvocation = positiveInteger(
      config.maxProviderTurnsPerInvocation,
      8,
    );
    this.maxPaidInvocationsPerPlan = positiveInteger(
      config.maxPaidInvocationsPerPlan,
      16,
    );
    this.maxSettledCostMicroRubPerPlan =
      config.maxSettledCostMicroRubPerPlan ?? config.maxReservationMicroRub * 8n;
    this.maxCommittedCostMicroRubPerPlan =
      config.maxCommittedCostMicroRubPerPlan ?? config.maxReservationMicroRub * 8n;
    if (
      this.maxSettledCostMicroRubPerPlan <= 0n ||
      this.maxCommittedCostMicroRubPerPlan <= 0n
    ) {
      throw new Error("plan spend ceilings must be positive");
    }
    this.cancellationPollMs = positiveInteger(config.cancellationPollMs, 250);
    this.artifacts = new ArtifactService(prisma);
  }

  async execute(input: InvocationExecutionInput): Promise<InvocationExecutionResult> {
    if (input.target.kind !== "AI_AUTO" && input.target.kind !== "AI_MODEL") {
      return terminal("AI_EXECUTOR_TARGET_MISMATCH");
    }

    try {
      const invocation = await this.loadInvocation(input);
      const output = parseSingleTextOutput(invocation.outputDeclarations);
      const messages = await this.buildMessages(invocation.plan.userId, input.invocationId, invocation.purpose);
      const model = await this.resolveModel(input, messages);
      const request = await this.beginOrReuseRequest(input, invocation, model, messages);

      if (request.kind === "replay") {
        await this.emitArtifact({
          invocationId: input.invocationId,
          userId: invocation.plan.userId,
          output,
          text: request.text,
          aiRequestId: request.aiRequestId,
          model,
        });
        return { status: "COMPLETED", outcome: "REPLAYED" };
      }
      if (request.kind === "in_progress") {
        return {
          status: "FAILED",
          errorCode: "AI_REQUEST_IN_PROGRESS",
          retryable: true,
        };
      }
      if (request.kind === "terminal_failure") {
        return terminal(request.errorCode);
      }
      if (request.kind === "capacity_wait") {
        return usageCapacityWait();
      }
      if (request.kind === "usage_blocked") {
        return usageBlocked();
      }

      let reservationId: string;
      try {
        const reservation = await this.billing.reserveUsage({
          userId: invocation.plan.userId,
          requestId: request.aiRequestId,
          estimatedProviderCostMicroRub: request.estimatedCostMicroRub,
          correlationId: input.idempotencyKey,
        });
        reservationId = reservation.id;
      } catch (error: unknown) {
        if (isBillingError(error) && error.code === "INSUFFICIENT_USAGE") {
          const capacity = await this.billing.getSpendableUsageState(invocation.plan.userId);
          return capacity.activeReservedMicroRub > 0n
            ? usageCapacityWait()
            : usageBlocked();
        }
        await this.prisma.$transaction([
          this.prisma.aiRequest.update({
            where: { id: request.aiRequestId },
            data: {
              status: "FAILED",
              financialStatus: "NONE",
              finishedAt: new Date(),
            },
          }),
          this.prisma.aIProviderTurn.update({
            where: { id: request.providerTurnId },
            data: { status: "FAILED_PRE_PROVIDER" },
          }),
        ]);
        if (isBillingError(error)) {
          return terminal(`BILLING_${error.code}`);
        }
        return {
          status: "FAILED",
          errorCode: "BILLING_RESERVATION_FAILED",
          retryable: true,
        };
      }

      await this.prisma.$transaction([
        this.prisma.aiRequest.update({
          where: { id: request.aiRequestId },
          data: {
            reservationId,
            status: "RESERVED",
            financialStatus: "RESERVED",
          },
        }),
        this.prisma.aIProviderTurn.update({
          where: { id: request.providerTurnId },
          data: { status: "RESERVED" },
        }),
      ]);

      const provider = await this.callProvider({
        aiRequestId: request.aiRequestId,
        providerTurnId: request.providerTurnId,
        reservationId,
        userId: invocation.plan.userId,
        model,
        messages,
        maxOutputTokens: request.maxOutputTokens,
        correlationId: input.idempotencyKey,
      });
      if (provider.kind === "failed") {
        return provider.result;
      }

      if (
        provider.usage.inputTokens > BigInt(request.estimatedInputTokens) ||
        provider.usage.outputTokens > BigInt(request.maxOutputTokens)
      ) {
        await this.markReconciliation(
          request.aiRequestId,
          request.providerTurnId,
          provider.text,
          "provider_usage_exceeded_funded_token_caps",
          provider.usage,
        );
        return terminal("AI_PROVIDER_BOUNDEDNESS_VIOLATION");
      }

      let actualCost: bigint;
      try {
        actualCost = providerCostFromUsage(provider.usage, model.price);
      } catch {
        await this.markReconciliation(
          request.aiRequestId,
          request.providerTurnId,
          provider.text,
          "invalid_provider_usage",
          provider.usage,
        );
        return terminal("AI_RECONCILIATION_REQUIRED");
      }

      if (actualCost > request.estimatedCostMicroRub) {
        await this.markReconciliation(
          request.aiRequestId,
          request.providerTurnId,
          provider.text,
          "provider_cost_exceeded_funded_reservation",
          provider.usage,
          actualCost,
        );
        return terminal("AI_PROVIDER_BOUNDEDNESS_VIOLATION");
      }

      await this.prisma.$transaction([
        this.prisma.aiRequest.update({
          where: { id: request.aiRequestId },
          data: {
            actualInputTokens: safeNumber(provider.usage.inputTokens),
            actualOutputTokens: safeNumber(provider.usage.outputTokens),
            reasoningTokens: safeNumber(provider.usage.reasoningTokens),
            cacheReadTokens: safeNumber(provider.usage.cacheReadTokens),
            cacheWriteTokens: safeNumber(provider.usage.cacheWriteTokens),
            providerActualCostMicroRub: actualCost,
            outputText: provider.text,
          },
        }),
        this.prisma.aIProviderTurn.update({
          where: { id: request.providerTurnId },
          data: { status: "USAGE_DURABLE" },
        }),
      ]);
      await this.prisma.aIProviderTurn.update({
        where: { id: request.providerTurnId },
        data: { status: "SETTLING" },
      });

      let settledStatus: string;
      let settledMicroRub: bigint;
      try {
        const settled = await this.billing.settleUsage({
          userId: invocation.plan.userId,
          reservationId,
          actualMicroRub: actualCost,
          correlationId: input.idempotencyKey,
        });
        settledStatus = settled.status;
        settledMicroRub = settled.settledMicroRub;
      } catch {
        await this.markReconciliation(
          request.aiRequestId,
          request.providerTurnId,
          provider.text,
          "settlement_failed_after_usage_durable",
          provider.usage,
          actualCost,
        );
        return terminal("AI_RECONCILIATION_REQUIRED");
      }

      await this.prisma.$transaction([
        this.prisma.aiRequest.update({
          where: { id: request.aiRequestId },
          data: {
            status: "SUCCEEDED",
            financialStatus: settledStatus === "ANOMALY" ? "ANOMALY" : "SETTLED",
            userSettledUsageMicroRub: settledMicroRub,
            finishedAt: new Date(),
          },
        }),
        this.prisma.aIProviderTurn.update({
          where: { id: request.providerTurnId },
          data: { status: "SUCCEEDED" },
        }),
      ]);

      await this.emitArtifact({
        invocationId: input.invocationId,
        userId: invocation.plan.userId,
        output,
        text: provider.text,
        aiRequestId: request.aiRequestId,
        model,
      });

      return { status: "COMPLETED", outcome: "PASS" };
    } catch (error: unknown) {
      if (error instanceof ExternalAiTerminalError) {
        return terminal(error.code);
      }
      if (
        error instanceof ArtifactError ||
        error instanceof ArtifactBindingError ||
        error instanceof ArtifactValidationError
      ) {
        return terminal("AI_ARTIFACT_CONTRACT_INVALID");
      }
      return {
        status: "FAILED",
        errorCode: "AI_EXECUTOR_ERROR",
        retryable: true,
      };
    }
  }

  private async loadInvocation(input: InvocationExecutionInput): Promise<InvocationRecord> {
    const invocation = await this.prisma.invocation.findFirst({
      where: { id: input.invocationId, planId: input.planId },
      select: {
        purpose: true,
        targetKind: true,
        targetModelSlug: true,
        outputDeclarations: true,
        plan: {
          select: {
            userId: true,
            conversationId: true,
          },
        },
      },
    });
    if (!invocation) {
      throw new ArtifactValidationError("Invocation was not found");
    }
    if (invocation.targetKind !== input.target.kind) {
      throw new ArtifactValidationError("Invocation target changed after plan freeze");
    }
    if (
      input.target.kind === "AI_MODEL" &&
      invocation.targetModelSlug !== input.target.modelSlug
    ) {
      throw new ArtifactValidationError("Exact model target changed after plan freeze");
    }
    return invocation;
  }

  private async buildMessages(
    userId: string,
    invocationId: string,
    purpose: string,
  ): Promise<ProviderChatMessage[]> {
    const bindings = await this.artifacts.resolveInputBindings({
      actorUserId: userId,
      targetInvocationId: invocationId,
    });
    const inputs: string[] = [];
    for (const binding of bindings) {
      const version = await this.artifacts.readVersion({
        actorUserId: userId,
        artifactVersionId: binding.reference.artifactVersionId,
      });
      if (version.content.kind !== "INLINE_JSON") {
        throw new ArtifactBindingError(
          `AI input ${JSON.stringify(binding.inputName)} is not inline content`,
        );
      }
      inputs.push(
        `${binding.inputName}: ${stringifyArtifactValue(version.content.value)}`,
      );
    }

    const content = inputs.length === 0
      ? purpose
      : [
          purpose,
          "",
          "DEPENDENCY_ARTIFACTS:",
          ...inputs,
        ].join("\n");

    return [{ role: "user", content }];
  }

  private async resolveModel(
    input: InvocationExecutionInput,
    messages: readonly ProviderChatMessage[],
  ): Promise<ResolvedModel> {
    const now = new Date();
    const exactModelSlug =
      input.target.kind === "AI_MODEL" ? input.target.modelSlug : null;
    if (input.target.kind === "AI_MODEL" && !exactModelSlug) {
      throw new ExternalAiTerminalError("AI_MODEL_UNAVAILABLE");
    }
    const models = await this.prisma.aiModel.findMany({
      where: {
        active: true,
        visible: true,
        ...(exactModelSlug ? { slug: exactModelSlug } : {}),
      },
      include: {
        priceVersions: {
          where: {
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          },
          orderBy: { effectiveFrom: "desc" },
        },
      },
      orderBy: { slug: "asc" },
    });

    const candidates = models.flatMap((model): ResolvedModel[] => {
      const priceVersion = model.priceVersions[0];
      if (!priceVersion) return [];
      const curated = VIMLA_AI_MODEL_CATALOG.find(
        (entry) =>
          entry.slug === model.slug &&
          entry.provider === model.provider &&
          entry.providerModelId === model.providerModelId,
      );
      return [{
        id: model.id,
        slug: model.slug,
        provider: model.provider,
        providerModelId: model.providerModelId,
        maxOutputTokens: model.maxOutputTokens,
        priceVersionId: priceVersion.id,
        billingBoundedness: curated?.billingBoundedness ?? "SOFT_BOUNDED",
        price: {
          inputMicroRubPerMillion: priceVersion.inputMicroRubPerMillion,
          outputMicroRubPerMillion: priceVersion.outputMicroRubPerMillion,
          cacheReadMicroRubPerMillion: priceVersion.cacheReadMicroRubPerMillion,
          cacheWriteMicroRubPerMillion: priceVersion.cacheWriteMicroRubPerMillion,
        },
      }];
    });

    if (candidates.length === 0) {
      throw new ExternalAiTerminalError(
        input.target.kind === "AI_MODEL"
          ? "AI_MODEL_UNAVAILABLE"
          : "AI_AUTO_NO_APPROVED_MODEL",
      );
    }

    const firstCandidate = candidates[0];
    if (!firstCandidate) {
      throw new ExternalAiTerminalError(
        input.target.kind === "AI_MODEL"
          ? "AI_MODEL_UNAVAILABLE"
          : "AI_AUTO_NO_APPROVED_MODEL",
      );
    }
    if (input.target.kind === "AI_MODEL") {
      if (firstCandidate.billingBoundedness !== "HARD_BOUNDED") {
        throw new ExternalAiTerminalError("AI_MODEL_BILLING_UNBOUNDED");
      }
      return firstCandidate;
    }

    const boundedCandidates = candidates.filter(
      (candidate) => candidate.billingBoundedness === "HARD_BOUNDED",
    );
    if (boundedCandidates.length === 0) {
      throw new ExternalAiTerminalError("AI_AUTO_NO_BOUNDED_MODEL");
    }

    const estimatedInputTokens = estimateInputTokens(messages);
    const ranked = [...boundedCandidates].sort((left, right) => {
      const leftCost = this.estimatedCost(left, estimatedInputTokens);
      const rightCost = this.estimatedCost(right, estimatedInputTokens);
      if (leftCost === rightCost) return left.slug.localeCompare(right.slug);
      return leftCost < rightCost ? -1 : 1;
    });
    return ranked[0] ?? boundedCandidates[0] ?? firstCandidate;
  }

  private estimatedCost(model: ResolvedModel, estimatedInputTokens: number): bigint {
    const maxOutputTokens = Math.min(
      this.config.budgetProfiles.STANDARD.preferredOutputTokens,
      model.maxOutputTokens,
    );
    return estimateReservationMicroRub({
      estimatedInputTokens: BigInt(estimatedInputTokens),
      maxOutputTokens: BigInt(maxOutputTokens),
      price: model.price,
      safetyBps: this.config.reservationSafetyBps,
    });
  }

  private async beginOrReuseRequest(
    input: InvocationExecutionInput,
    invocation: InvocationRecord,
    model: ResolvedModel,
    messages: readonly ProviderChatMessage[],
  ): Promise<
    | {
        kind: "new";
        aiRequestId: string;
        providerTurnId: string;
        providerTurnIdempotencyKey: string;
        estimatedCostMicroRub: bigint;
        estimatedInputTokens: number;
        maxOutputTokens: number;
      }
    | { kind: "replay"; aiRequestId: string; text: string }
    | { kind: "in_progress" }
    | { kind: "capacity_wait" }
    | { kind: "usage_blocked" }
    | { kind: "terminal_failure"; errorCode: string }
  > {
    const clientRequestId = orchestrationAiClientRequestId(input.invocationId);
    const existing = await this.prisma.aiRequest.findUnique({
      where: {
        userId_clientRequestId: {
          userId: invocation.plan.userId,
          clientRequestId,
        },
      },
      include: { providerTurn: true },
    });
    if (existing) {
      if (
        existing.status === "CREATED" &&
        existing.financialStatus === "NONE" &&
        existing.providerTurn
      ) {
        return {
          kind: "new",
          aiRequestId: existing.id,
          providerTurnId: existing.providerTurn.id,
          providerTurnIdempotencyKey: existing.providerTurn.idempotencyKey,
          estimatedCostMicroRub: existing.estimatedCostMicroRub,
          estimatedInputTokens: existing.estimatedInputTokens,
          maxOutputTokens: existing.maxOutputTokens,
        };
      }
      return existingAiRequestOutcome(existing);
    }

    const estimatedInputTokens = estimateInputTokens(messages);
    const capacity = await this.billing.getSpendableUsageState(invocation.plan.userId);
    const availableMicroRub = capacity.availableMicroRub;
    const budgetResult = resolveAiExecutionBudget({
      profile: "STANDARD",
      profiles: this.config.budgetProfiles,
      modelMaxOutputTokens: model.maxOutputTokens,
      estimatedInputTokens,
      availableMicroRub,
      maxReservationMicroRub: this.config.maxReservationMicroRub,
      price: model.price,
      safetyBps: this.config.reservationSafetyBps,
    });
    if (budgetResult.kind === "INSUFFICIENT_USAGE") {
      return capacity.activeReservedMicroRub > 0n
        ? { kind: "capacity_wait" }
        : { kind: "usage_blocked" };
    }
    if (budgetResult.kind === "REQUEST_COST_LIMIT") {
      return {
        kind: "terminal_failure",
        errorCode: "AI_REQUEST_COST_LIMIT",
      };
    }

    const maxOutputTokens = budgetResult.budget.selectedOutputTokens;
    const estimatedCostMicroRub = budgetResult.budget.estimatedCostMicroRub;

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const aiRequest = await tx.aiRequest.create({
          data: {
            userId: invocation.plan.userId,
            conversationId: invocation.plan.conversationId,
            modelId: model.id,
            priceVersionId: model.priceVersionId,
            clientRequestId,
            provider: model.provider,
            providerModelId: model.providerModelId,
            status: "CREATED",
            financialStatus: "NONE",
            estimatedInputTokens,
            maxOutputTokens,
            estimatedCostMicroRub,
          },
        });
        const run = await tx.invocationRun.update({
          where: { id: input.runId },
          data: {
            aiExecution: {
              create: {
                aiRequestId: aiRequest.id,
              },
            },
          },
          select: {
            aiExecution: {
              select: { id: true },
            },
          },
        });
        if (!run.aiExecution) {
          throw new Error("AI execution was not created");
        }
        const providerTurnIdempotencyKey =
          orchestrationAiProviderTurnIdempotencyKey(input.invocationId, 0);
        const providerTurn = await tx.aIProviderTurn.create({
          data: {
            aiExecutionId: run.aiExecution.id,
            turnIndex: 0,
            aiRequestId: aiRequest.id,
            idempotencyKey: providerTurnIdempotencyKey,
            status: "CREATED",
          },
        });
        return { aiRequest, providerTurn };
      });
      return {
        kind: "new",
        aiRequestId: created.aiRequest.id,
        providerTurnId: created.providerTurn.id,
        providerTurnIdempotencyKey: created.providerTurn.idempotencyKey,
        estimatedCostMicroRub,
        estimatedInputTokens,
        maxOutputTokens,
      };
    } catch (error: unknown) {
      if (!isUniqueConstraint(error)) throw error;
      const replay = await this.prisma.aiRequest.findUnique({
        where: {
          userId_clientRequestId: {
            userId: invocation.plan.userId,
            clientRequestId,
          },
        },
      });
      if (!replay) {
        return { kind: "in_progress" };
      }
      return existingAiRequestOutcome(replay);
    }
  }

  private async callProvider(input: {
    aiRequestId: string;
    providerTurnId: string;
    reservationId: string;
    userId: string;
    model: ResolvedModel;
    messages: readonly ProviderChatMessage[];
    maxOutputTokens: number;
    correlationId: string;
  }): Promise<
    | { kind: "ok"; text: string; usage: NormalizedUsage }
    | { kind: "failed"; result: InvocationExecutionResult }
  > {
    if (
      this.gateway.activeProvider.id !== "mock" &&
      this.gateway.activeProvider.id !== input.model.provider
    ) {
      await this.releaseReservationAfterSafeFailure(
        input.aiRequestId,
        input.providerTurnId,
        input.userId,
        input.reservationId,
        input.correlationId,
        "provider_configuration_mismatch",
      );
      return { kind: "failed", result: terminal("AI_PROVIDER_CONFIGURATION_MISMATCH") };
    }

    await this.prisma.$transaction([
      this.prisma.aiRequest.update({
        where: { id: input.aiRequestId },
        data: { status: "PROVIDER_STARTED", startedAt: new Date() },
      }),
      this.prisma.aIProviderTurn.update({
        where: { id: input.providerTurnId },
        data: { status: "PROVIDER_STARTING" },
      }),
    ]);

    let text = "";
    let usage: NormalizedUsage | null = null;
    try {
      const session = await this.gateway.streamChat({
        providerModelId: input.model.providerModelId,
        messages: input.messages,
        maxOutputTokens: input.maxOutputTokens,
        correlationId: input.correlationId,
      });
      await this.prisma.$transaction([
        this.prisma.aiRequest.update({
          where: { id: input.aiRequestId },
          data: {
            status: "STREAMING",
            providerRequestId: session.providerRequestId,
          },
        }),
        this.prisma.aIProviderTurn.update({
          where: { id: input.providerTurnId },
          data: { status: "PROVIDER_IN_FLIGHT" },
        }),
      ]);

      for await (const event of session.events) {
        if (event.type === "delta") text += event.text;
        if (event.type === "usage") usage = event.usage;
      }
    } catch (error: unknown) {
      if (error instanceof ProviderCallError) {
        if (error.kind === "ambiguous") {
          await this.markReconciliation(
            input.aiRequestId,
            input.providerTurnId,
            text,
            "ambiguous_provider_failure",
          );
          return { kind: "failed", result: terminal("AI_RECONCILIATION_REQUIRED") };
        }
        const released = await this.releaseReservationAfterSafeFailure(
          input.aiRequestId,
          input.providerTurnId,
          input.userId,
          input.reservationId,
          input.correlationId,
          error.kind,
        );
        return {
          kind: "failed",
          result: released
            ? terminal(
                error.kind === "balance"
                  ? "AI_PROVIDER_BALANCE"
                  : "AI_PROVIDER_REJECTED",
              )
            : terminal("AI_RECONCILIATION_REQUIRED"),
        };
      }
      await this.markReconciliation(
        input.aiRequestId,
        input.providerTurnId,
        text,
        "unknown_provider_failure",
      );
      return { kind: "failed", result: terminal("AI_RECONCILIATION_REQUIRED") };
    }

    if (!usage) {
      await this.markReconciliation(
        input.aiRequestId,
        input.providerTurnId,
        text,
        "missing_terminal_usage",
      );
      return { kind: "failed", result: terminal("AI_RECONCILIATION_REQUIRED") };
    }

    return { kind: "ok", text, usage };
  }

  private async releaseReservationAfterSafeFailure(
    aiRequestId: string,
    providerTurnId: string,
    userId: string,
    reservationId: string,
    correlationId: string,
    reason: string,
  ): Promise<boolean> {
    try {
      await this.billing.releaseUsage({
        userId,
        reservationId,
        correlationId,
      });
      await this.prisma.$transaction([
        this.prisma.aiRequest.update({
          where: { id: aiRequestId },
          data: {
            status: "FAILED",
            financialStatus: "RELEASED",
            finishedAt: new Date(),
          },
        }),
        this.prisma.aIProviderTurn.update({
          where: { id: providerTurnId },
          data: { status: "FAILED_SAFE_PROVIDER" },
        }),
      ]);
      return true;
    } catch {
      await this.markReconciliation(
        aiRequestId,
        providerTurnId,
        reason,
        "release_failed_after_safe_provider_failure",
      );
      return false;
    }
  }

  private async markReconciliation(
    aiRequestId: string,
    providerTurnId: string,
    text: string,
    _reason: string,
    usage?: NormalizedUsage,
    actualCostMicroRub?: bigint,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.aiRequest.update({
        where: { id: aiRequestId },
        data: {
          status: "RECONCILIATION_REQUIRED",
          financialStatus: "RECONCILIATION_HOLD",
          outputText: text,
          ...(usage
            ? {
                actualInputTokens: safeNumber(usage.inputTokens),
                actualOutputTokens: safeNumber(usage.outputTokens),
                reasoningTokens: safeNumber(usage.reasoningTokens),
                cacheReadTokens: safeNumber(usage.cacheReadTokens),
                cacheWriteTokens: safeNumber(usage.cacheWriteTokens),
              }
            : {}),
          ...(actualCostMicroRub !== undefined
            ? { providerActualCostMicroRub: actualCostMicroRub }
            : {}),
          finishedAt: new Date(),
        },
      }),
      this.prisma.aIProviderTurn.update({
        where: { id: providerTurnId },
        data: { status: "RECONCILIATION_REQUIRED" },
      }),
    ]);
  }

  private async emitArtifact(input: {
    invocationId: string;
    userId: string;
    output: { name: string; type: ArtifactType };
    text: string;
    aiRequestId: string;
    model: ResolvedModel;
  }): Promise<void> {
    await this.artifacts.createArtifact({
      actorUserId: input.userId,
      creatorInvocationId: input.invocationId,
      outputName: input.output.name,
      type: input.output.type,
      classification: "PRIVATE",
      content: {
        kind: "INLINE_JSON",
        value: { text: input.text },
      },
      metadata: {
        source: "AI_EXECUTION",
        aiRequestId: input.aiRequestId,
        modelSlug: input.model.slug,
        provider: input.model.provider,
      },
    });
  }
}

export function orchestrationAiClientRequestId(invocationId: string): string {
  return `orchestration:${invocationId}:ai:v1`;
}

export function orchestrationAiProviderTurnIdempotencyKey(
  invocationId: string,
  turnIndex: number,
): string {
  if (!Number.isInteger(turnIndex) || turnIndex < 0) {
    throw new Error("turnIndex must be a non-negative integer");
  }
  return `${orchestrationAiClientRequestId(invocationId)}:turn:${turnIndex}`;
}

function existingAiRequestOutcome(existing: {
  id: string;
  status: string;
  outputText: string | null;
}):
  | { kind: "replay"; aiRequestId: string; text: string }
  | { kind: "in_progress" }
  | { kind: "terminal_failure"; errorCode: string } {
  if (existing.status === "SUCCEEDED" && existing.outputText !== null) {
    return {
      kind: "replay",
      aiRequestId: existing.id,
      text: existing.outputText,
    };
  }
  if (IN_PROGRESS_AI_STATUSES.has(existing.status)) {
    return { kind: "in_progress" };
  }
  if (existing.status === "RECONCILIATION_REQUIRED") {
    return {
      kind: "terminal_failure",
      errorCode: "AI_RECONCILIATION_REQUIRED",
    };
  }
  return {
    kind: "terminal_failure",
    errorCode: "AI_REQUEST_PREVIOUSLY_FAILED",
  };
}

function parseSingleTextOutput(
  value: Prisma.JsonValue,
): { name: string; type: ArtifactType } {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new ArtifactValidationError("AI invocation must declare exactly one output");
  }
  const item = value[0];
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new ArtifactValidationError("AI output declaration is invalid");
  }
  const record = item as Record<string, Prisma.JsonValue>;
  if (typeof record.name !== "string" || typeof record.artifactType !== "string") {
    throw new ArtifactValidationError("AI output declaration is invalid");
  }
  if (!SUPPORTED_TEXT_OUTPUT_TYPES.has(record.artifactType as ArtifactType)) {
    throw new ArtifactValidationError("AI text executor cannot emit this artifact type");
  }
  return {
    name: record.name,
    type: record.artifactType as ArtifactType,
  };
}

function stringifyArtifactValue(value: Prisma.InputJsonValue): string {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "text" in value &&
    typeof (value as { text?: unknown }).text === "string"
  ) {
    return (value as { text: string }).text;
  }
  return JSON.stringify(value);
}

function usageCapacityWait(): InvocationExecutionResult {
  return {
    status: "WAITING_FOR_USAGE_CAPACITY",
    errorCode: "BILLING_INSUFFICIENT_USAGE",
  };
}

function usageBlocked(): InvocationExecutionResult {
  return {
    status: "BLOCKED_INSUFFICIENT_USAGE",
    errorCode: "BILLING_INSUFFICIENT_USAGE",
  };
}

function terminal(errorCode: string): InvocationExecutionResult {
  return {
    status: "FAILED",
    errorCode,
    retryable: false,
  };
}

function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Number(value);
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

class ExternalAiTerminalError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
