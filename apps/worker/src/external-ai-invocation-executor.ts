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
  type NormalizedUsage,
  type PriceVersionQuote,
  type ProviderChatMessage,
  type VimlaAiGateway,
} from "@vimla/ai";
import {
  isBillingError,
  type BillingEngine,
} from "@vimla/billing";
import { type Prisma, type PrismaClient } from "@vimla/database";
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
  defaultMaxOutputTokens: number;
  reservationSafetyBps: bigint;
  maxReservationMicroRub: bigint;
}

type ResolvedModel = {
  id: string;
  slug: string;
  provider: string;
  providerModelId: string;
  maxOutputTokens: number;
  priceVersionId: string;
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

  constructor(
    private readonly prisma: PrismaClient,
    private readonly billing: BillingEngine,
    private readonly gateway: VimlaAiGateway,
    private readonly config: ExternalAiExecutorConfig,
  ) {
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
        await this.prisma.aiRequest.update({
          where: { id: request.aiRequestId },
          data: {
            status: "FAILED",
            financialStatus: "NONE",
            finishedAt: new Date(),
          },
        });
        if (isBillingError(error)) {
          return terminal(`BILLING_${error.code}`);
        }
        return {
          status: "FAILED",
          errorCode: "BILLING_RESERVATION_FAILED",
          retryable: true,
        };
      }

      await this.prisma.aiRequest.update({
        where: { id: request.aiRequestId },
        data: {
          reservationId,
          status: "RESERVED",
          financialStatus: "RESERVED",
        },
      });

      const provider = await this.callProvider({
        aiRequestId: request.aiRequestId,
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

      let actualCost: bigint;
      try {
        actualCost = providerCostFromUsage(provider.usage, model.price);
      } catch {
        await this.markReconciliation(request.aiRequestId, provider.text, "invalid_provider_usage");
        return terminal("AI_RECONCILIATION_REQUIRED");
      }

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
        await this.prisma.aiRequest.update({
          where: { id: request.aiRequestId },
          data: {
            status: "RECONCILIATION_REQUIRED",
            financialStatus: "RECONCILIATION_HOLD",
            providerActualCostMicroRub: actualCost,
            actualInputTokens: safeNumber(provider.usage.inputTokens),
            actualOutputTokens: safeNumber(provider.usage.outputTokens),
            reasoningTokens: safeNumber(provider.usage.reasoningTokens),
            cacheReadTokens: safeNumber(provider.usage.cacheReadTokens),
            cacheWriteTokens: safeNumber(provider.usage.cacheWriteTokens),
            outputText: provider.text,
            finishedAt: new Date(),
          },
        });
        return terminal("AI_RECONCILIATION_REQUIRED");
      }

      await this.prisma.aiRequest.update({
        where: { id: request.aiRequestId },
        data: {
          status: "SUCCEEDED",
          financialStatus: settledStatus === "ANOMALY" ? "ANOMALY" : "SETTLED",
          actualInputTokens: safeNumber(provider.usage.inputTokens),
          actualOutputTokens: safeNumber(provider.usage.outputTokens),
          reasoningTokens: safeNumber(provider.usage.reasoningTokens),
          cacheReadTokens: safeNumber(provider.usage.cacheReadTokens),
          cacheWriteTokens: safeNumber(provider.usage.cacheWriteTokens),
          providerActualCostMicroRub: actualCost,
          userSettledUsageMicroRub: settledMicroRub,
          outputText: provider.text,
          finishedAt: new Date(),
        },
      });

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
    const models = await this.prisma.aiModel.findMany({
      where: {
        active: true,
        visible: true,
        ...(input.target.kind === "AI_MODEL"
          ? { slug: input.target.modelSlug }
          : {}),
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
      return [{
        id: model.id,
        slug: model.slug,
        provider: model.provider,
        providerModelId: model.providerModelId,
        maxOutputTokens: model.maxOutputTokens,
        priceVersionId: priceVersion.id,
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
      return firstCandidate;
    }

    const estimatedInputTokens = estimateInputTokens(messages);
    const ranked = [...candidates].sort((left, right) => {
      const leftCost = this.estimatedCost(left, estimatedInputTokens);
      const rightCost = this.estimatedCost(right, estimatedInputTokens);
      if (leftCost === rightCost) return left.slug.localeCompare(right.slug);
      return leftCost < rightCost ? -1 : 1;
    });
    return ranked[0] ?? firstCandidate;
  }

  private estimatedCost(model: ResolvedModel, estimatedInputTokens: number): bigint {
    const maxOutputTokens = Math.min(
      this.config.defaultMaxOutputTokens,
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
        estimatedCostMicroRub: bigint;
        maxOutputTokens: number;
      }
    | { kind: "replay"; aiRequestId: string; text: string }
    | { kind: "in_progress" }
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
    });
    if (existing) {
      return existingAiRequestOutcome(existing);
    }

    const estimatedInputTokens = estimateInputTokens(messages);
    const maxOutputTokens = Math.min(
      this.config.defaultMaxOutputTokens,
      model.maxOutputTokens,
    );
    const estimatedCostMicroRub = this.estimatedCost(model, estimatedInputTokens);
    if (estimatedCostMicroRub > this.config.maxReservationMicroRub) {
      return {
        kind: "terminal_failure",
        errorCode: "AI_REQUEST_COST_LIMIT",
      };
    }

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
        await tx.invocationRun.update({
          where: { id: input.runId },
          data: {
            aiExecution: {
              create: {
                aiRequestId: aiRequest.id,
              },
            },
          },
        });
        return aiRequest;
      });
      return {
        kind: "new",
        aiRequestId: created.id,
        estimatedCostMicroRub,
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
        input.userId,
        input.reservationId,
        input.correlationId,
        "provider_configuration_mismatch",
      );
      return { kind: "failed", result: terminal("AI_PROVIDER_CONFIGURATION_MISMATCH") };
    }

    await this.prisma.aiRequest.update({
      where: { id: input.aiRequestId },
      data: { status: "PROVIDER_STARTED", startedAt: new Date() },
    });

    let text = "";
    let usage: NormalizedUsage | null = null;
    try {
      const session = await this.gateway.streamChat({
        providerModelId: input.model.providerModelId,
        messages: input.messages,
        maxOutputTokens: input.maxOutputTokens,
        correlationId: input.correlationId,
      });
      await this.prisma.aiRequest.update({
        where: { id: input.aiRequestId },
        data: {
          status: "STREAMING",
          providerRequestId: session.providerRequestId,
        },
      });

      for await (const event of session.events) {
        if (event.type === "delta") text += event.text;
        if (event.type === "usage") usage = event.usage;
      }
    } catch (error: unknown) {
      if (error instanceof ProviderCallError) {
        if (error.kind === "ambiguous") {
          await this.markReconciliation(
            input.aiRequestId,
            text,
            "ambiguous_provider_failure",
          );
          return { kind: "failed", result: terminal("AI_RECONCILIATION_REQUIRED") };
        }
        const released = await this.releaseReservationAfterSafeFailure(
          input.aiRequestId,
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
        text,
        "unknown_provider_failure",
      );
      return { kind: "failed", result: terminal("AI_RECONCILIATION_REQUIRED") };
    }

    if (!usage) {
      await this.markReconciliation(
        input.aiRequestId,
        text,
        "missing_terminal_usage",
      );
      return { kind: "failed", result: terminal("AI_RECONCILIATION_REQUIRED") };
    }

    return { kind: "ok", text, usage };
  }

  private async releaseReservationAfterSafeFailure(
    aiRequestId: string,
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
      await this.prisma.aiRequest.update({
        where: { id: aiRequestId },
        data: {
          status: "FAILED",
          financialStatus: "RELEASED",
          finishedAt: new Date(),
        },
      });
      return true;
    } catch {
      await this.prisma.aiRequest.update({
        where: { id: aiRequestId },
        data: {
          status: "RECONCILIATION_REQUIRED",
          financialStatus: "RECONCILIATION_HOLD",
          outputText: reason,
          finishedAt: new Date(),
        },
      });
      return false;
    }
  }

  private async markReconciliation(
    aiRequestId: string,
    text: string,
    _reason: string,
  ): Promise<void> {
    await this.prisma.aiRequest.update({
      where: { id: aiRequestId },
      data: {
        status: "RECONCILIATION_REQUIRED",
        financialStatus: "RECONCILIATION_HOLD",
        outputText: text,
        finishedAt: new Date(),
      },
    });
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

function stringifyArtifactValue(value: Prisma.JsonValue): string {
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
