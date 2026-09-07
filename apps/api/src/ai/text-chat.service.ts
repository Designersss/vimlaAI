import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  AiError,
  encodeVimlaSse,
  estimateInputTokens,
  estimateReservationMicroRub,
  providerCostFromUsage,
  selectContextMessages,
  utf8ByteLength,
  ProviderCallError,
  type PriceVersionQuote,
  type ProviderChatMessage,
  type ProviderStreamEvent,
  type VimlaAiGateway,
} from "@vimla/ai";
import type { BillingEngine, ReservationView } from "@vimla/billing";
import type { SendMessage } from "@vimla/contracts";
import { Prisma, type PrismaClient } from "@vimla/database";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { BillingService } from "../billing/billing.service.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { AiConcurrencyService } from "./concurrency.service.js";
import { AI_GATEWAY } from "./ai.tokens.js";

const IN_PROGRESS_STATUSES = new Set([
  "CREATED",
  "RESERVED",
  "PROVIDER_STARTED",
  "STREAMING",
]);

export interface StreamSink {
  isClientOpen(): boolean;
  write(chunk: string): void;
}

@Injectable()
export class TextChatService {
  private readonly logger = new Logger(TextChatService.name);

  constructor(
    @Inject(PrismaService) private readonly prismaService: PrismaService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(AI_GATEWAY) private readonly gateway: VimlaAiGateway,
    @Inject(AiConcurrencyService) private readonly concurrency: AiConcurrencyService,
    @Inject(API_CONFIG) private readonly config: ApiRuntimeConfig,
  ) {}

  private get prisma(): PrismaClient {
    return this.prismaService.client;
  }

  private get engine(): BillingEngine {
    return this.billing.engine;
  }

  async listRetailModels() {
    const now = new Date();
    const models = await this.prisma.aiModel.findMany({
      where: { active: true, visible: true },
      include: { priceVersions: true },
      orderBy: { displayName: "asc" },
    });

    return models
      .filter((model) =>
        model.priceVersions.some(
          (version) =>
            version.effectiveFrom <= now &&
            (version.effectiveTo === null || version.effectiveTo > now),
        ),
      )
      .map((model) => ({
        id: model.id,
        slug: model.slug,
        displayName: model.displayName,
        vendor: model.vendor,
        supportsStreaming: model.supportsStreaming,
      }));
  }

  async createConversation(userId: string, title?: string) {
    return this.prisma.conversation.create({
      data: { userId, title: title ?? null },
    });
  }

  async listConversations(userId: string) {
    return this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
  }

  async getConversation(userId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conversation) {
      throw new NotFoundException("Conversation was not found");
    }

    return conversation;
  }

  async streamMessage(input: {
    userId: string;
    conversationId: string;
    body: SendMessage;
    correlationId: string;
    sink: StreamSink;
  }): Promise<void> {
    if (!this.config.aiTextEnabled) {
      throw new AiError("AI_DISABLED", "Text AI is temporarily disabled", 503);
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: { id: input.conversationId, userId: input.userId },
    });
    if (!conversation) {
      throw new NotFoundException("Conversation was not found");
    }

    if (utf8ByteLength(input.body.content) > this.config.aiMaxMessageBytes) {
      throw new AiError("MESSAGE_TOO_LARGE", "Message exceeds the configured size limit", 400);
    }

    const model = await this.resolveModel(input.body.modelId);
    const outcome = await this.beginOrReuseRequest({
      userId: input.userId,
      conversationId: conversation.id,
      body: input.body,
      model,
      correlationId: input.correlationId,
    });

    if (outcome.kind === "replay") {
      this.writeEvent(input.sink, "start", { aiRequestId: outcome.aiRequestId });
      if (outcome.text.length > 0) {
        this.writeEvent(input.sink, "delta", { text: outcome.text });
      }
      this.writeEvent(input.sink, "done", { messageId: outcome.messageId, aiRequestId: outcome.aiRequestId });
      return;
    }

    await this.concurrency.acquire(input.userId);
    try {
      await this.runProviderFlow({
        userId: input.userId,
        conversation,
        aiRequestId: outcome.aiRequestId,
        model,
        correlationId: input.correlationId,
        sink: input.sink,
      });
    } finally {
      await this.concurrency.release(input.userId);
    }
  }

  private async runProviderFlow(input: {
    userId: string;
    conversation: { id: string; title: string | null };
    aiRequestId: string;
    model: ResolvedModel;
    correlationId: string;
    sink: StreamSink;
  }): Promise<void> {
    const history = await this.prisma.message.findMany({
      where: { conversationId: input.conversation.id, status: "COMPLETE" },
      orderBy: { createdAt: "asc" },
    });
    const context = selectContextMessages(history, this.config.aiMaxContextBytes);
    const providerMessages: ProviderChatMessage[] = context.map((message) => ({
      role: message.role === "ASSISTANT" ? "assistant" : "user",
      content: message.content,
    }));

    const estimatedInputTokens = estimateInputTokens(providerMessages);
    const maxOutputTokens = Math.min(
      this.config.aiDefaultMaxOutputTokens,
      input.model.maxOutputTokens,
    );
    const estimatedCostMicroRub = estimateReservationMicroRub({
      estimatedInputTokens: BigInt(estimatedInputTokens),
      maxOutputTokens: BigInt(maxOutputTokens),
      price: input.model.price,
      safetyBps: BigInt(this.config.aiReservationSafetyBps),
    });
    const maxReservation = BigInt(this.config.aiMaxReservationMicroRub);
    if (estimatedCostMicroRub > maxReservation) {
      await this.prisma.aiRequest.update({
        where: { id: input.aiRequestId },
        data: { status: "FAILED", finishedAt: new Date() },
      });
      throw new AiError("AI_REQUEST_COST_LIMIT", "Estimated request cost exceeds the safety cap", 400);
    }

    await this.prisma.aiRequest.update({
      where: { id: input.aiRequestId },
      data: {
        estimatedInputTokens,
        maxOutputTokens,
        estimatedCostMicroRub,
      },
    });

    let reservationId: string;
    try {
      const reserved = await this.engine.reserveUsage({
        userId: input.userId,
        requestId: input.aiRequestId,
        estimatedProviderCostMicroRub: estimatedCostMicroRub,
        correlationId: input.correlationId,
      });
      reservationId = reserved.id;
    } catch (error: unknown) {
      await this.prisma.aiRequest.update({
        where: { id: input.aiRequestId },
        data: { status: "FAILED", finishedAt: new Date() },
      });
      throw error;
    }

    await this.prisma.aiRequest.update({
      where: { id: input.aiRequestId },
      data: {
        reservationId,
        status: "RESERVED",
        financialStatus: "RESERVED",
      },
    });

    this.writeEvent(input.sink, "start", { aiRequestId: input.aiRequestId });

    await this.prisma.aiRequest.update({
      where: { id: input.aiRequestId },
      data: { status: "PROVIDER_STARTED", startedAt: new Date() },
    });

    let assistantText = "";
    let usageEvent: Extract<ProviderStreamEvent, { type: "usage" }>["usage"] | null = null;

    try {
      const session = await this.gateway.streamChat({
        providerModelId: input.model.providerModelId,
        messages: providerMessages,
        maxOutputTokens,
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
        if (event.type === "delta") {
          assistantText += event.text;
          this.writeEvent(input.sink, "delta", { text: event.text });
        }
        if (event.type === "usage") {
          usageEvent = event.usage;
        }
      }
    } catch (error: unknown) {
      await this.handleProviderFailure({
        userId: input.userId,
        aiRequestId: input.aiRequestId,
        reservationId,
        correlationId: input.correlationId,
        error,
      });
      throw error;
    }

    if (!usageEvent) {
      await this.markReconciliation({
        aiRequestId: input.aiRequestId,
        conversationId: input.conversation.id,
        assistantText,
        reason: "missing_terminal_usage",
      });
      throw new AiError(
        "AI_RECONCILIATION_REQUIRED",
        "Provider usage was not received; the request needs reconciliation",
        503,
      );
    }

    let providerActualCostMicroRub: bigint;
    try {
      providerActualCostMicroRub = providerCostFromUsage(usageEvent, input.model.price);
    } catch {
      await this.markReconciliation({
        aiRequestId: input.aiRequestId,
        conversationId: input.conversation.id,
        assistantText,
        reason: "invalid_provider_usage",
      });
      throw new AiError(
        "AI_RECONCILIATION_REQUIRED",
        "Provider usage could not be normalized and needs reconciliation",
        503,
      );
    }

    let settled: ReservationView;
    try {
      settled = await this.engine.settleUsage({
        userId: input.userId,
        reservationId,
        actualMicroRub: providerActualCostMicroRub,
        correlationId: input.correlationId,
      });
    } catch {
      await this.prisma.aiRequest.update({
        where: { id: input.aiRequestId },
        data: {
          status: "RECONCILIATION_REQUIRED",
          financialStatus: "RECONCILIATION_HOLD",
          providerActualCostMicroRub,
          actualInputTokens: numberTokens(usageEvent.inputTokens),
          actualOutputTokens: numberTokens(usageEvent.outputTokens),
          reasoningTokens: numberTokens(usageEvent.reasoningTokens),
          cacheReadTokens: numberTokens(usageEvent.cacheReadTokens),
          cacheWriteTokens: numberTokens(usageEvent.cacheWriteTokens),
          finishedAt: new Date(),
        },
      });
      if (assistantText.length > 0) {
        await this.prisma.message.create({
          data: {
            conversationId: input.conversation.id,
            role: "ASSISTANT",
            content: assistantText,
            status: "COMPLETE",
            aiRequestId: input.aiRequestId,
          },
        });
      }
      this.logger.error({
        aiRequestId: input.aiRequestId,
        operation: "ai_reconciliation",
        reason: "settlement_failed",
        result: "RECONCILIATION_REQUIRED",
        providerActualCostMicroRub: providerActualCostMicroRub.toString(10),
      });
      throw new AiError(
        "AI_RECONCILIATION_REQUIRED",
        "Provider usage could not be settled and needs reconciliation",
        503,
      );
    }

    const assistant = await this.prisma.message.create({
      data: {
        conversationId: input.conversation.id,
        role: "ASSISTANT",
        content: assistantText,
        status: "COMPLETE",
        aiRequestId: input.aiRequestId,
      },
    });

    await this.prisma.conversation.update({
      where: { id: input.conversation.id },
      data: { updatedAt: new Date() },
    });

    await this.prisma.aiRequest.update({
      where: { id: input.aiRequestId },
      data: {
        status: "SUCCEEDED",
        financialStatus: settled.status === "ANOMALY" ? "ANOMALY" : "SETTLED",
        actualInputTokens: numberTokens(usageEvent.inputTokens),
        actualOutputTokens: numberTokens(usageEvent.outputTokens),
        reasoningTokens: numberTokens(usageEvent.reasoningTokens),
        cacheReadTokens: numberTokens(usageEvent.cacheReadTokens),
        cacheWriteTokens: numberTokens(usageEvent.cacheWriteTokens),
        providerActualCostMicroRub,
        userSettledUsageMicroRub: settled.settledMicroRub,
        finishedAt: new Date(),
      },
    });

    this.logger.log({
      requestId: input.correlationId,
      userId: input.userId,
      conversationId: input.conversation.id,
      aiRequestId: input.aiRequestId,
      reservationId,
      modelId: input.model.id,
      providerModelId: input.model.providerModelId,
      estimatedCostMicroRub: estimatedCostMicroRub.toString(10),
      providerActualCostMicroRub: providerActualCostMicroRub.toString(10),
      userSettledUsageMicroRub: settled.settledMicroRub.toString(10),
      status: "SUCCEEDED",
      financialStatus: settled.status,
    });

    this.writeEvent(input.sink, "done", {
      messageId: assistant.id,
      aiRequestId: input.aiRequestId,
    });
  }

  private async beginOrReuseRequest(input: {
    userId: string;
    conversationId: string;
    body: SendMessage;
    model: ResolvedModel;
    correlationId: string;
  }): Promise<
    | { kind: "new"; aiRequestId: string }
    | { kind: "replay"; aiRequestId: string; messageId: string; text: string }
  > {
    try {
      const created = await this.prisma.aiRequest.create({
        data: {
          userId: input.userId,
          conversationId: input.conversationId,
          modelId: input.model.id,
          priceVersionId: input.model.priceVersionId,
          clientRequestId: input.body.clientRequestId,
          provider: input.model.provider,
          providerModelId: input.model.providerModelId,
          status: "CREATED",
          financialStatus: "NONE",
          estimatedInputTokens: 0,
          maxOutputTokens: 1,
          estimatedCostMicroRub: 0n,
        },
      });

      await this.prisma.message.create({
        data: {
          conversationId: input.conversationId,
          role: "USER",
          content: input.body.content,
          status: "COMPLETE",
          aiRequestId: created.id,
        },
      });

      await this.prisma.conversation.update({
        where: { id: input.conversationId },
        data: {
          updatedAt: new Date(),
          title: titleFrom(input.body.content),
        },
      });

      return { kind: "new", aiRequestId: created.id };
    } catch (error: unknown) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
    }

    const existing = await this.prisma.aiRequest.findUnique({
      where: {
        userId_clientRequestId: {
          userId: input.userId,
          clientRequestId: input.body.clientRequestId,
        },
      },
      include: { messages: { where: { role: "ASSISTANT" }, orderBy: { createdAt: "asc" } } },
    });
    if (!existing) {
      throw new AiError("AI_REQUEST_IN_PROGRESS", "Duplicate request could not be loaded", 409);
    }

    if (existing.status === "SUCCEEDED") {
      const assistant = existing.messages[0];
      return {
        kind: "replay",
        aiRequestId: existing.id,
        messageId: assistant?.id ?? existing.id,
        text: assistant?.content ?? "",
      };
    }

    if (IN_PROGRESS_STATUSES.has(existing.status)) {
      throw new AiError("AI_REQUEST_IN_PROGRESS", "This request is already in progress", 409);
    }

    throw new AiError(
      "AI_RECONCILIATION_REQUIRED",
      "Retry this request with a new clientRequestId",
      409,
    );
  }

  private async resolveModel(modelId: string): Promise<ResolvedModel> {
    const model = await this.prisma.aiModel.findUnique({
      where: { id: modelId },
      include: { priceVersions: { orderBy: { effectiveFrom: "desc" } } },
    });
    if (!model) {
      throw new AiError("UNKNOWN_MODEL", "Model was not found", 400);
    }
    if (!model.active || !model.visible) {
      throw new AiError("INACTIVE_MODEL", "Model is not available", 400);
    }

    const now = new Date();
    const price = model.priceVersions.find(
      (version) =>
        version.effectiveFrom <= now && (version.effectiveTo === null || version.effectiveTo > now),
    );
    if (!price) {
      throw new AiError("MODEL_UNAVAILABLE", "Model has no active price version", 400);
    }

    return {
      id: model.id,
      provider: model.provider,
      providerModelId: model.providerModelId,
      maxOutputTokens: model.maxOutputTokens,
      priceVersionId: price.id,
      price: {
        inputMicroRubPerMillion: price.inputMicroRubPerMillion,
        outputMicroRubPerMillion: price.outputMicroRubPerMillion,
        cacheReadMicroRubPerMillion: price.cacheReadMicroRubPerMillion,
        cacheWriteMicroRubPerMillion: price.cacheWriteMicroRubPerMillion,
      },
    };
  }

  private async handleProviderFailure(input: {
    userId: string;
    aiRequestId: string;
    reservationId: string;
    correlationId: string;
    error: unknown;
  }): Promise<void> {
    const kind = input.error instanceof ProviderCallError ? input.error.kind : "ambiguous";

    if (kind === "rejected" || kind === "balance") {
      await this.engine.releaseUsage({
        userId: input.userId,
        reservationId: input.reservationId,
        correlationId: input.correlationId,
      });
      await this.prisma.aiRequest.update({
        where: { id: input.aiRequestId },
        data: {
          status: "FAILED",
          financialStatus: "RELEASED",
          finishedAt: new Date(),
        },
      });
      if (kind === "balance") {
        throw new AiError(
          "AI_PROVIDER_BALANCE_UNAVAILABLE",
          "The AI provider is temporarily unavailable",
          503,
        );
      }
      throw new AiError("PROVIDER_REJECTED", "The AI provider rejected the request", 502);
    }

    await this.markReconciliation({
      aiRequestId: input.aiRequestId,
      conversationId: null,
      assistantText: "",
      reason: "ambiguous_provider_failure",
    });
    throw new AiError(
      "AI_RECONCILIATION_REQUIRED",
      "The provider outcome is uncertain and needs reconciliation",
      503,
    );
  }

  private async markReconciliation(input: {
    aiRequestId: string;
    conversationId: string | null;
    assistantText: string;
    reason: string;
  }): Promise<void> {
    this.logger.error({
      aiRequestId: input.aiRequestId,
      operation: "ai_reconciliation",
      reason: input.reason,
      result: "RECONCILIATION_REQUIRED",
    });

    if (input.conversationId && input.assistantText.length > 0) {
      await this.prisma.message.create({
        data: {
          conversationId: input.conversationId,
          role: "ASSISTANT",
          content: input.assistantText,
          status: "COMPLETE",
          aiRequestId: input.aiRequestId,
        },
      });
    }

    await this.prisma.aiRequest.update({
      where: { id: input.aiRequestId },
      data: {
        status: "RECONCILIATION_REQUIRED",
        financialStatus: "RECONCILIATION_HOLD",
        finishedAt: new Date(),
      },
    });
  }

  private writeEvent(sink: StreamSink, event: string, data: Record<string, unknown>): void {
    if (!sink.isClientOpen()) {
      return;
    }

    sink.write(encodeVimlaSse(event, data));
  }
}

interface ResolvedModel {
  id: string;
  provider: string;
  providerModelId: string;
  maxOutputTokens: number;
  priceVersionId: string;
  price: PriceVersionQuote;
}

function titleFrom(content: string): string {
  const line = content.trim().split("\n")[0] ?? "New chat";
  return line.slice(0, 80);
}

function numberTokens(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number.MAX_SAFE_INTEGER;
  }

  return Number(value);
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
