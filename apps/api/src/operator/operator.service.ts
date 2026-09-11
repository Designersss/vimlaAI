import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@vimla/database";
import {
  confirmOperatorRunSchema,
  continueOperatorRunSchema,
  createOperatorRunSchema,
  type OperatorRunView,
} from "@vimla/contracts";
import {
  OperatorError,
  buildPlannerPrompt,
  confirmationTokenMatches,
  executeStep,
  generateConfirmationToken,
  hashConfirmationToken,
  loadWorkspaceSnapshot,
  parsePlannerOutput,
  prepareSteps,
  sanitizePublicText,
  type OperatorToolContext,
  type PreparedStep,
  type SafeProfile,
  type TaskOwnerResolution,
} from "@vimla/operator";
import { filterOperatorContextBundle, resolveDirectChatAssignee } from "@vimla/direct-chats";
import { WorkspaceError } from "@vimla/workspace";
import { NotificationPlatformError } from "@vimla/notifications";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { TextChatService } from "../ai/text-chat.service.js";
import { DirectChatsFacade } from "../direct-chats/direct-chats.facade.js";
import { WorkspaceFacade } from "../workspace/workspace.facade.js";
import { NotificationsFacade } from "../notifications/notifications.facade.js";
import { parseVimlaLocale } from "@vimla/shared";
import { buildOperatorRunView } from "./view.js";

@Injectable()
export class OperatorService {
  private readonly logger = new Logger(OperatorService.name);

  constructor(
    @Inject(PrismaService) private readonly prismaService: PrismaService,
    @Inject(WorkspaceFacade) private readonly workspace: WorkspaceFacade,
    @Inject(NotificationsFacade) private readonly notifications: NotificationsFacade,
    @Inject(TextChatService) private readonly chat: TextChatService,
    @Inject(DirectChatsFacade) private readonly directChats: DirectChatsFacade,
    @Inject(API_CONFIG) private readonly config: ApiRuntimeConfig,
  ) {}

  assertEnabled(): void {
    if (!this.config.operatorEnabled) {
      throw new OperatorError("DISABLED", "The Vimla operator is disabled");
    }
  }

  async getOperatorConversation(userId: string) {
    this.assertEnabled();
    const conversation = await this.prisma.conversation.findFirst({
      where: { userId, kind: "OPERATOR" },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          include: { operatorRun: { include: { steps: { orderBy: { sequence: "asc" } } } } },
        },
      },
    });
    if (!conversation) {
      return { id: null, title: null, messages: [] as const };
    }
    return {
      id: conversation.id,
      title: conversation.title,
      messages: conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        status: message.status,
        createdAt: message.createdAt.toISOString(),
        operatorRun: message.operatorRun ? buildOperatorRunView(message.operatorRun, null) : null,
      })),
    };
  }

  async getRun(userId: string, runId: string): Promise<OperatorRunView> {
    this.assertEnabled();
    const run = await this.loadOwnedRun(userId, runId);
    let confirmationToken: string | null = null;
    if (run.status === "AWAITING_CONFIRMATION") {
      confirmationToken = await this.rotateConfirmationToken(run.id);
    }
    return this.toView(run, confirmationToken);
  }

  async createRun(
    userId: string,
    body: unknown,
    correlationId: string,
  ): Promise<OperatorRunView> {
    this.assertEnabled();
    const input = createOperatorRunSchema.parse(body);
    const scope = input.invocationScope ?? "PERSONAL";
    if (scope === "DIRECT_CHAT") {
      this.directChats.assertEnabled();
    }
    const existing = await this.prisma.operatorRun.findUnique({
      where: { userId_clientRequestId: { userId, clientRequestId: input.clientRequestId } },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });
    if (existing) {
      return this.resumeExisting(existing, correlationId);
    }

    const conversation = await this.resolveConversation(userId, scope === "DIRECT_CHAT" ? undefined : input.conversationId);
    const locale = await this.userLocale(userId);
    let userMessageId: string | null = null;
    if (scope !== "DIRECT_CHAT") {
      const userMessage = await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "USER",
          content: input.content,
          status: "COMPLETE",
        },
      });
      userMessageId = userMessage.id;
    }

    const scoped = await this.resolveDirectChatScope(userId, scope, input.directConversationId, input.contextBundle);

    try {
      const run = await this.prisma.operatorRun.create({
        data: {
          userId,
          conversationId: conversation.id,
          userMessageId,
          clientRequestId: input.clientRequestId,
          plannerClientRequestId: randomUUID(),
          status: "PLANNING",
          userText: input.content,
          locale,
          invocationScope: scope,
          directConversationId: scoped.directConversationId,
          contextOwnIncluded: scoped.ownIncluded,
          contextPeerIncluded: scoped.peerIncluded,
          contextPeerDenied: scoped.peerDenied,
        },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
      return await this.planAndMaybeExecute(run, correlationId, null, scoped.untrustedContext);
    } catch (error: unknown) {
      if (isUniqueConstraint(error)) {
        const replay = await this.prisma.operatorRun.findUnique({
          where: { userId_clientRequestId: { userId, clientRequestId: input.clientRequestId } },
          include: { steps: { orderBy: { sequence: "asc" } } },
        });
        if (replay) {
          return this.resumeExisting(replay, correlationId);
        }
      }
      throw error;
    }
  }

  async confirmRun(userId: string, runId: string, body: unknown, correlationId: string): Promise<OperatorRunView> {
    this.assertEnabled();
    const input = confirmOperatorRunSchema.parse(body);
    const run = await this.loadOwnedRun(userId, runId);
    if (run.status === "SUCCEEDED" || run.status === "PARTIAL" || run.status === "CANCELED" || run.status === "FAILED") {
      return this.toView(run, null);
    }
    if (run.status === "EXECUTING") {
      const context = await this.toolContext(run);
      const executed = await this.executePersistedSteps(run.id, context, correlationId, true);
      if (executed.status === "CLARIFY") {
        return this.awaitClarification(run.id, executed.publicMessage, executed.question);
      }
      return this.finishRun(run.id, executed.publicMessage, executed.status, executed.confirmationToken);
    }
    if (run.status !== "AWAITING_CONFIRMATION") {
      throw new OperatorError("CONFIRMATION_INVALID", "This run is not waiting for confirmation");
    }
    if (!run.confirmationTokenHash || !run.confirmationExpiresAt || run.confirmationExpiresAt < new Date()) {
      throw new OperatorError("CONFIRMATION_INVALID", "Confirmation expired");
    }
    if (!confirmationTokenMatches(input.confirmationToken, run.confirmationTokenHash, this.config.betterAuthSecret)) {
      throw new OperatorError("CONFIRMATION_INVALID", "Confirmation token is invalid");
    }

    await this.prisma.operatorRun.update({
      where: { id: run.id },
      data: { status: "EXECUTING", confirmationTokenHash: null, confirmationExpiresAt: null },
    });

    const context = await this.toolContext(run);
    const executed = await this.executePersistedSteps(run.id, context, correlationId, true);
    if (executed.status === "CLARIFY") {
      return this.awaitClarification(run.id, executed.publicMessage, executed.question);
    }
    return this.finishRun(run.id, executed.publicMessage, executed.status, executed.confirmationToken);
  }

  async continueRun(
    userId: string,
    runId: string,
    body: unknown,
    correlationId: string,
  ): Promise<OperatorRunView> {
    this.assertEnabled();
    const input = continueOperatorRunSchema.parse(body);
    const run = await this.loadOwnedRun(userId, runId);
    if (run.continueClientRequestId === input.clientRequestId) {
      return this.toView(run, null);
    }
    if (run.status !== "AWAITING_CLARIFICATION") {
      throw new OperatorError("CLARIFICATION_REQUIRED", "This run is not waiting for clarification");
    }

    if (run.invocationScope !== "DIRECT_CHAT") {
      await this.prisma.message.create({
        data: {
          conversationId: run.conversationId,
          role: "USER",
          content: input.content,
          status: "COMPLETE",
        },
      });
    }

    await this.prisma.operatorRun.update({
      where: { id: run.id },
      data: {
        status: "PLANNING",
        continueClientRequestId: input.clientRequestId,
        plannerClientRequestId: randomUUID(),
        plannerOutput: null,
        assistantMessageId: null,
        userText: `${run.userText}\n${input.content}`,
      },
    });

    const reloaded = await this.loadOwnedRun(userId, runId);
    return this.planAndMaybeExecute(reloaded, correlationId, run.clarificationQuestion);
  }

  async cancelRun(userId: string, runId: string): Promise<OperatorRunView> {
    this.assertEnabled();
    const run = await this.loadOwnedRun(userId, runId);
    if (run.status === "SUCCEEDED" || run.status === "PARTIAL") {
      return this.toView(run, null);
    }
    const updated = await this.prisma.operatorRun.update({
      where: { id: run.id },
      data: { status: "CANCELED", confirmationTokenHash: null, confirmationExpiresAt: null },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });
    return this.toView(updated, null);
  }

  private async planAndMaybeExecute(
    run: RunRecord,
    correlationId: string,
    previousClarification: string | null,
    untrustedContext: string | null = null,
  ): Promise<OperatorRunView> {
    const context = await this.toolContext(run);
    const snapshot = await loadWorkspaceSnapshot(context);
    const prompt = buildPlannerPrompt({
      userText: run.userText,
      locale: run.locale,
      snapshot,
      previousClarification,
      invocationScope: run.invocationScope === "DIRECT_CHAT" ? "DIRECT_CHAT" : "PERSONAL",
      participantNames: context.invocation.participantNames,
      untrustedContext,
    });

    let plannerOutput = run.plannerOutput;
    if (!plannerOutput) {
      const plannerClientRequestId = run.plannerClientRequestId ?? randomUUID();
      const completion = await this.chat.completeInternalPrompt({
        userId: run.userId,
        conversationId: run.conversationId,
        clientRequestId: plannerClientRequestId,
        messages: [{ role: "user", content: prompt }],
        correlationId,
      });
      plannerOutput = completion.text;
      await this.prisma.operatorRun.update({
        where: { id: run.id },
        data: { plannerOutput, plannerAiRequestId: completion.aiRequestId, plannerClientRequestId },
      });
    }

    let plan;
    try {
      plan = parsePlannerOutput(plannerOutput);
    } catch {
      return this.failRun(run.id, "operator_plan_invalid", "I could not understand that request. Try a more specific instruction.");
    }

    if (plan.intent === "clarify") {
      return this.awaitClarification(run.id, plan.userMessage, plan.clarificationQuestion ?? "Could you clarify?");
    }
    if (plan.intent === "answer" || plan.intent === "refuse" || plan.commands.length === 0) {
      return this.succeedWithoutTools(run.id, plan.userMessage);
    }

    let steps: PreparedStep[];
    try {
      steps = prepareSteps(plan.commands).slice(0, this.config.operatorMaxToolsPerRun);
    } catch (error: unknown) {
      if (error instanceof OperatorError) {
        return this.failRun(run.id, "operator_plan_invalid", plan.userMessage);
      }
      throw error;
    }

    await this.replaceSteps(run.id, steps);

    const confirmationRequired = steps.some((step) => step.confirmationRequired);
    if (confirmationRequired) {
      const token = generateConfirmationToken();
      const updated = await this.prisma.operatorRun.update({
        where: { id: run.id },
        data: {
          status: "AWAITING_CONFIRMATION",
          publicMessage: sanitizePublicText(plan.userMessage, 2_000),
          confirmationTokenHash: hashConfirmationToken(token, this.config.betterAuthSecret),
          confirmationExpiresAt: new Date(Date.now() + this.config.operatorConfirmationTtlSeconds * 1_000),
        },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
      await this.persistAssistant(updated, updated.publicMessage ?? plan.userMessage);
      this.logger.log({ msg: "operator.confirm_required", operatorRunId: run.id, actorUserId: run.userId });
      return this.toView(updated, token);
    }

    await this.prisma.operatorRun.update({
      where: { id: run.id },
      data: { status: "EXECUTING", publicMessage: sanitizePublicText(plan.userMessage, 2_000) },
    });
    const executed = await this.executePersistedSteps(run.id, context, correlationId, false);
    if (executed.status === "CLARIFY") {
      return this.awaitClarification(run.id, executed.publicMessage, executed.question);
    }
    return this.finishRun(run.id, executed.publicMessage || plan.userMessage, executed.status, null);
  }

  private async executePersistedSteps(
    runId: string,
    context: OperatorToolContext,
    correlationId: string,
    confirmed: boolean,
  ): Promise<{
    status: "SUCCEEDED" | "PARTIAL" | "FAILED" | "CLARIFY";
    publicMessage: string;
    confirmationToken: string | null;
    question: string;
  }> {
    const steps = await this.prisma.operatorRunStep.findMany({
      where: { runId },
      orderBy: { sequence: "asc" },
    });

    let executed = 0;
    let failed = 0;
    const titles: string[] = [];

    for (const step of steps) {
      if (step.status === "EXECUTED") {
        executed += 1;
        titles.push(step.publicTitle);
        continue;
      }
      if (step.status === "FAILED") {
        failed += 1;
        continue;
      }
      if (step.status === "SKIPPED") {
        continue;
      }
      if (step.status === "NEEDS_CONFIRMATION" && !confirmed) {
        continue;
      }

      const claimable = confirmed
        ? (["PENDING", "NEEDS_CONFIRMATION", "CONFIRMED"] as const)
        : (["PENDING", "CONFIRMED"] as const);
      const claimed = await this.prisma.operatorRunStep.updateMany({
        where: { id: step.id, status: { in: [...claimable] } },
        data: { status: "CONFIRMED" },
      });
      if (claimed.count === 0) {
        const latest = await this.prisma.operatorRunStep.findUnique({ where: { id: step.id } });
        if (latest?.status === "EXECUTED") {
          executed += 1;
          titles.push(latest.publicTitle);
        } else if (latest?.status === "FAILED") {
          failed += 1;
        }
        continue;
      }

      const args = asRecord(step.inputJson);
      try {
        const result = await executeStep(step.toolName, args, context);
        await this.prisma.operatorRunStep.update({
          where: { id: step.id },
          data: {
            status: "EXECUTED",
            publicTitle: result.card.title,
            publicDetail: result.card.detail,
            publicHrefPath: result.card.hrefPath,
            publicKind: result.card.kind,
            objectId: result.objectId,
            executedAt: new Date(),
            errorCode: null,
          },
        });
        await this.audit(runId, context.actor.userId, step.toolName, result.card.operation, result.card.kind, result.objectId, "ok");
        executed += 1;
        titles.push(result.card.title);
      } catch (error: unknown) {
        if (error instanceof OperatorError && error.code === "CLARIFICATION_REQUIRED") {
          return {
            status: "CLARIFY",
            publicMessage: error.message,
            confirmationToken: null,
            question: error.message,
          };
        }
        const code = errorCodeOf(error);
        await this.prisma.operatorRunStep.update({
          where: { id: step.id },
          data: { status: "FAILED", errorCode: code },
        });
        await this.audit(runId, context.actor.userId, step.toolName, "failed", step.publicKind, step.objectId, code);
        failed += 1;
        this.logger.warn({
          msg: "operator.step_failed",
          operatorRunId: runId,
          actorUserId: context.actor.userId,
          toolName: step.toolName,
          errorCode: code,
          correlationId,
        });
      }
    }

    const status = failed === 0 ? "SUCCEEDED" : executed === 0 ? "FAILED" : "PARTIAL";
    const publicMessage =
      status === "SUCCEEDED"
        ? titles.length > 0
          ? titles.join(" · ")
          : "Done."
        : status === "PARTIAL"
          ? "Some actions completed, others failed."
          : "I could not complete that action.";
    return { status, publicMessage, confirmationToken: null, question: "" };
  }

  private async finishRun(
    runId: string,
    publicMessage: string,
    status: "SUCCEEDED" | "PARTIAL" | "FAILED",
    confirmationToken: string | null,
  ): Promise<OperatorRunView> {
    const updated = await this.prisma.operatorRun.update({
      where: { id: runId },
      data: { status, publicMessage: sanitizePublicText(publicMessage, 2_000), errorCode: status === "FAILED" ? "operator_plan_invalid" : null },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });
    await this.persistAssistant(updated, updated.publicMessage ?? publicMessage);
    this.logger.log({ msg: "operator.finished", operatorRunId: runId, actorUserId: updated.userId, status });
    return this.toView(updated, confirmationToken);
  }

  private async succeedWithoutTools(runId: string, message: string): Promise<OperatorRunView> {
    const updated = await this.prisma.operatorRun.update({
      where: { id: runId },
      data: { status: "SUCCEEDED", publicMessage: sanitizePublicText(message, 2_000) },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });
    await this.persistAssistant(updated, updated.publicMessage ?? message);
    return this.toView(updated, null);
  }

  private async awaitClarification(runId: string, message: string, question: string): Promise<OperatorRunView> {
    const updated = await this.prisma.operatorRun.update({
      where: { id: runId },
      data: {
        status: "AWAITING_CLARIFICATION",
        publicMessage: sanitizePublicText(message, 2_000),
        clarificationQuestion: sanitizePublicText(question, 500),
      },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });
    await this.persistAssistant(updated, `${updated.publicMessage ?? message}\n${updated.clarificationQuestion ?? question}`);
    return this.toView(updated, null);
  }

  private async failRun(runId: string, errorCode: string, message: string): Promise<OperatorRunView> {
    const updated = await this.prisma.operatorRun.update({
      where: { id: runId },
      data: { status: "FAILED", errorCode, publicMessage: sanitizePublicText(message, 2_000) },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });
    await this.persistAssistant(updated, updated.publicMessage ?? message);
    return this.toView(updated, null);
  }

  private async replaceSteps(runId: string, steps: PreparedStep[]): Promise<void> {
    await this.prisma.operatorRunStep.deleteMany({ where: { runId } });
    if (steps.length === 0) {
      return;
    }
    await this.prisma.operatorRunStep.createMany({
      data: steps.map((step) => ({
        runId,
        sequence: step.sequence,
        toolName: step.toolName,
        status: step.confirmationRequired ? "NEEDS_CONFIRMATION" : "PENDING",
        inputJson: step.args as Prisma.InputJsonValue,
        publicKind: step.card.kind,
        publicTitle: step.card.title,
        publicDetail: step.card.detail,
        publicHrefPath: step.card.hrefPath,
        idempotencyKey: step.idempotencyKey,
      })),
    });
  }

  private async persistAssistant(
    run: { id: string; conversationId: string; assistantMessageId: string | null; invocationScope?: string | null },
    content: string,
  ): Promise<void> {
    if (run.invocationScope === "DIRECT_CHAT") {
      return;
    }
    const text = sanitizePublicText(content, 2_000) || "Done.";
    if (run.assistantMessageId) {
      await this.prisma.message.update({
        where: { id: run.assistantMessageId },
        data: { content: text, operatorRunId: run.id, status: "COMPLETE" },
      });
      return;
    }
    const message = await this.prisma.message.create({
      data: {
        conversationId: run.conversationId,
        role: "ASSISTANT",
        content: text,
        status: "COMPLETE",
        operatorRunId: run.id,
      },
    });
    await this.prisma.operatorRun.update({
      where: { id: run.id },
      data: { assistantMessageId: message.id },
    });
  }

  private async audit(
    runId: string,
    userId: string,
    toolName: string,
    operation: string,
    objectKind: string | null,
    objectId: string | null,
    result: string,
  ): Promise<void> {
    await this.prisma.operatorAuditEvent.create({
      data: { runId, userId, toolName, operation, objectKind, objectId, result },
    });
  }

  private async toolContext(run: RunRecord): Promise<OperatorToolContext> {
    const timezone = await this.workspace.storedTimezone(run.userId);
    const locale = await this.userLocale(run.userId);
    const scope = run.invocationScope === "DIRECT_CHAT" ? "DIRECT_CHAT" : "PERSONAL";
    const participants =
      scope === "DIRECT_CHAT" && run.directConversationId
        ? await this.directChats.chats.participants(run.userId, run.directConversationId)
        : [];
    const resolveTaskOwner = (hint?: string): TaskOwnerResolution => {
      if (scope !== "DIRECT_CHAT") {
        if (!hint || ["me", "myself", "мне", "себе", "меня", "я"].includes(hint.trim().toLocaleLowerCase("en"))) {
          return {
            type: "ok",
            ownerUserId: run.userId,
            assignedByUserId: null,
            assignmentSourceType: null,
            assignmentSourceId: null,
          };
        }
        return { type: "deny", message: "Tasks can only be created for you in this conversation." };
      }
      const resolved = resolveDirectChatAssignee(hint, run.userId, participants);
      if (resolved.type === "self") {
        return {
          type: "ok",
          ownerUserId: run.userId,
          assignedByUserId: null,
          assignmentSourceType: null,
          assignmentSourceId: null,
        };
      }
      if (resolved.type === "peer") {
        return {
          type: "ok",
          ownerUserId: resolved.userId,
          assignedByUserId: run.userId,
          assignmentSourceType: "DIRECT_CHAT",
          assignmentSourceId: run.directConversationId,
        };
      }
      if (resolved.type === "clarify") {
        return { type: "clarify", question: "Who should I assign this task to in this chat?" };
      }
      return { type: "deny", message: "That person is not a participant in this Direct Chat." };
    };
    return {
      actor: this.workspace.actor(run.userId),
      source: { conversationId: run.conversationId, messageId: run.userMessageId ?? undefined },
      timezone,
      locale,
      defaultLocale: this.config.authDefaultLocale,
      now: new Date(),
      services: {
        tasks: this.workspace.tasks,
        reminders: this.workspace.reminders,
        lists: this.workspace.lists,
        notes: this.workspace.notes,
        today: this.workspace.today,
        notifications: this.notifications.preferences,
        getSafeProfile: (id) => this.getSafeProfile(id),
      },
      invocation: {
        scope,
        directConversationId: run.directConversationId,
        participantNames: participants.map((participant) => participant.name),
        contextMessages: [],
        resolveTaskOwner,
      },
    };
  }

  private async resolveDirectChatScope(
    userId: string,
    scope: "PERSONAL" | "DIRECT_CHAT",
    directConversationId: string | undefined,
    contextBundle: { messages: Array<{ senderUserId: string; sentAt: string; text: string }> } | undefined,
  ): Promise<{
    directConversationId: string | null;
    ownIncluded: boolean;
    peerIncluded: boolean;
    peerDenied: boolean;
    untrustedContext: string | null;
  }> {
    if (scope !== "DIRECT_CHAT" || !directConversationId) {
      return {
        directConversationId: null,
        ownIncluded: false,
        peerIncluded: false,
        peerDenied: false,
        untrustedContext: null,
      };
    }
    const consent = await this.directChats.chats.consent(userId, directConversationId);
    const filtered = filterOperatorContextBundle({
      actorUserId: userId,
      memberIds: consent.memberIds,
      consent,
      messages: contextBundle?.messages ?? [],
    });
    const untrustedContext =
      filtered.messages.length === 0
        ? null
        : filtered.messages
            .map((message) => `${message.senderUserId === userId ? "self" : "peer"} at ${message.sentAt}: ${message.text}`)
            .join("\n");
    return {
      directConversationId,
      ownIncluded: filtered.ownIncluded,
      peerIncluded: filtered.peerIncluded,
      peerDenied: filtered.peerDenied,
      untrustedContext,
    };
  }

  private async getSafeProfile(userId: string): Promise<SafeProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { preference: true },
    });
    if (!user) {
      throw new OperatorError("NOT_FOUND", "User not found");
    }
    return {
      name: user.name,
      locale: parseVimlaLocale(user.preference?.locale, this.config.authDefaultLocale),
      timezone: user.preference?.timezone ?? null,
      emailVerified: user.emailVerified,
    };
  }

  private async resolveConversation(userId: string, conversationId: string | undefined) {
    if (conversationId) {
      const existing = await this.prisma.conversation.findFirst({
        where: { id: conversationId, userId },
      });
      if (!existing) {
        throw new NotFoundException("Conversation was not found");
      }
      return existing;
    }

    const found = await this.prisma.conversation.findFirst({
      where: { userId, kind: "OPERATOR" },
    });
    if (found) {
      return found;
    }
    try {
      return await this.prisma.conversation.create({
        data: { userId, kind: "OPERATOR", title: "Vimla" },
      });
    } catch (error: unknown) {
      if (!isUniqueConstraint(error)) {
        throw error;
      }
      const replay = await this.prisma.conversation.findFirst({
        where: { userId, kind: "OPERATOR" },
      });
      if (!replay) {
        throw error;
      }
      return replay;
    }
  }

  private async loadOwnedRun(userId: string, runId: string): Promise<RunRecord> {
    const run = await this.prisma.operatorRun.findFirst({
      where: { id: runId, userId },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });
    if (!run) {
      throw new NotFoundException("Operator run was not found");
    }
    return run;
  }

  private async rotateConfirmationToken(runId: string): Promise<string> {
    const token = generateConfirmationToken();
    await this.prisma.operatorRun.update({
      where: { id: runId },
      data: {
        confirmationTokenHash: hashConfirmationToken(token, this.config.betterAuthSecret),
        confirmationExpiresAt: new Date(Date.now() + this.config.operatorConfirmationTtlSeconds * 1_000),
      },
    });
    return token;
  }

  private toView(run: RunRecord, confirmationToken: string | null): OperatorRunView {
    return buildOperatorRunView(run, confirmationToken);
  }

  private async resumeExisting(run: RunRecord, correlationId: string): Promise<OperatorRunView> {
    if (run.status === "CREATED" || run.status === "PLANNING") {
      return this.planAndMaybeExecute(run, correlationId, run.clarificationQuestion);
    }
    if (run.status === "EXECUTING") {
      const context = await this.toolContext(run);
      const executed = await this.executePersistedSteps(run.id, context, correlationId, false);
      if (executed.status === "CLARIFY") {
        return this.awaitClarification(run.id, executed.publicMessage, executed.question);
      }
      return this.finishRun(run.id, executed.publicMessage, executed.status, null);
    }
    if (run.status === "AWAITING_CONFIRMATION") {
      const token = await this.rotateConfirmationToken(run.id);
      return this.toView(run, token);
    }
    return this.toView(run, null);
  }

  private async userLocale(userId: string): Promise<"ru" | "en"> {
    const preference = await this.prisma.userPreference.findUnique({ where: { userId } });
    return parseVimlaLocale(preference?.locale, this.config.authDefaultLocale);
  }

  private get prisma() {
    return this.prismaService.client;
  }
}

type RunRecord = Prisma.OperatorRunGetPayload<{ include: { steps: true } }>;

function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function errorCodeOf(error: unknown): string {
  if (error instanceof WorkspaceError) {
    return error.code.toLowerCase();
  }
  if (error instanceof NotificationPlatformError) {
    return error.code.toLowerCase();
  }
  if (error instanceof OperatorError) {
    return error.code.toLowerCase();
  }
  return "internal_error";
}

function isUniqueConstraint(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
