import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { mockOperatorPlannerResponse } from "@vimla/ai";
import {
  SurfaceAccessDeniedError,
  SurfaceAuthorityUnavailableError,
  SurfaceIdentityUnavailableError,
  createSurfaceAuthorityRegistry,
  freezeDirectOperatorContextSnapshot,
  loadDirectOperatorContextSnapshot,
} from "@vimla/context";
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
  selectDirectChatPlannerOutput,
  sanitizePublicText,
  type OperatorToolContext,
  type PreparedStep,
  type SafeProfile,
  type TaskOwnerResolution,
} from "@vimla/operator";
import {
  DirectChatError,
  resolveDirectChatAssignee,
} from "@vimla/direct-chats";
import {
  ListService,
  NoteService,
  ReminderService,
  TaskService,
  WorkspaceError,
  WorkspaceTodayService,
} from "@vimla/workspace";
import { NotificationPlatformError, NotificationPreferenceService } from "@vimla/notifications";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { PrismaService } from "../persistence/prisma.service.js";
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
      const contextFailure = await this.failIfDirectChatContextRevoked(run);
      if (contextFailure) {
        return contextFailure;
      }
      confirmationToken = await this.rotateConfirmationToken(run.id);
      if (!confirmationToken) {
        return this.toView(
          await this.loadOwnedRun(userId, runId),
          null,
        );
      }
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
    const scoped = await this.resolveDirectChatScope(
      userId,
      scope,
      input.directConversationId,
      input.directSourceMessageId,
      input.contextBundle,
    );

    try {
      const run = await this.prisma.$transaction(async (tx) => {
        let userMessageId: string | null = null;
        if (scope !== "DIRECT_CHAT") {
          const userMessage = await tx.message.create({
            data: {
              conversationId: conversation.id,
              role: "USER",
              content: input.content,
              status: "COMPLETE",
            },
          });
          userMessageId = userMessage.id;
        }

        if (scope === "DIRECT_CHAT" && scoped.directConversationId) {
          await this.assertDirectChatDisclosureConsentTx(
            tx,
            scoped.directConversationId,
            userId,
            scoped.messages,
          );
        }

        const runId = randomUUID();
        const created = await tx.operatorRun.create({
          data: {
            id: runId,
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
        if (
          scope === "DIRECT_CHAT" &&
          scoped.directConversationId &&
          scoped.sourceMessageId &&
          scoped.sourceMessageCreatedAt
        ) {
          await freezeDirectOperatorContextSnapshot(tx, {
            operatorRunId: runId,
            actorUserId: userId,
            directConversationId: scoped.directConversationId,
            sourceMessageId: scoped.sourceMessageId,
            sourceMessageCreatedAt: scoped.sourceMessageCreatedAt,
            userText: input.content,
            messages: scoped.messages,
          });
        }
        return created;
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
    const current = await this.loadOwnedRun(userId, runId);
    if (
      current.status === "AWAITING_CONFIRMATION" ||
      current.status === "EXECUTING"
    ) {
      const contextFailure = await this.failIfDirectChatContextRevoked(current);
      if (contextFailure) {
        return contextFailure;
      }
    }
    const run = await this.acceptConfirmation(userId, runId, input.confirmationToken);
    if (run.status === "SUCCEEDED" || run.status === "PARTIAL" || run.status === "CANCELED" || run.status === "FAILED") {
      return this.toView(run, null);
    }
    if (run.status === "EXECUTING") {
      const contextFailure = await this.failIfDirectChatContextRevoked(run);
      if (contextFailure) {
        return contextFailure;
      }
      const context = await this.toolContext(run);
      const executed = await this.executePersistedSteps(run.id, context, correlationId);
      if (executed.status === "CLARIFY") {
        return this.awaitClarification(run.id, executed.publicMessage, executed.question);
      }
      return this.finishRun(run.id, executed.publicMessage, executed.status, executed.confirmationToken);
    }
    throw new OperatorError("CONFIRMATION_INVALID", "This run is not waiting for confirmation");
  }

  private async acceptConfirmation(userId: string, runId: string, token: string): Promise<RunRecord> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "operator_run"
        WHERE "id" = ${runId} AND "userId" = ${userId}
        FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new NotFoundException("Operator run was not found");
      }

      const current = await tx.operatorRun.findUniqueOrThrow({
        where: { id: runId },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
      if (current.status !== "AWAITING_CONFIRMATION") {
        return current;
      }
      if (!current.confirmationTokenHash || !current.confirmationExpiresAt || current.confirmationExpiresAt < new Date()) {
        throw new OperatorError("CONFIRMATION_INVALID", "Confirmation expired");
      }
      if (!confirmationTokenMatches(token, current.confirmationTokenHash, this.config.betterAuthSecret)) {
        throw new OperatorError("CONFIRMATION_INVALID", "Confirmation token is invalid");
      }

      const confirmableSteps = current.steps.filter((step) => step.status === "NEEDS_CONFIRMATION");
      if (confirmableSteps.length > 0) {
        await tx.operatorRunStep.updateMany({
          where: { runId, status: "NEEDS_CONFIRMATION" },
          data: { status: "CONFIRMED" },
        });
        await tx.operatorAuditEvent.createMany({
          data: confirmableSteps.map((step) => ({
            runId,
            userId,
            toolName: step.toolName,
            operation: "confirmation_accepted",
            objectKind: "operator_step",
            objectId: step.id,
            result: "accepted",
          })),
        });
      }
      return tx.operatorRun.update({
        where: { id: runId },
        data: { status: "EXECUTING", confirmationTokenHash: null, confirmationExpiresAt: null },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
    });
  }

  async continueRun(
    userId: string,
    runId: string,
    body: unknown,
    correlationId: string,
  ): Promise<OperatorRunView> {
    this.assertEnabled();
    const input = continueOperatorRunSchema.parse(body);
    const existing = await this.loadOwnedRun(userId, runId);
    if (existing.invocationScope === "DIRECT_CHAT") {
      throw new OperatorError(
        "VALIDATION_ERROR",
        "Direct Chat clarification requires a new encrypted @Vimla invocation",
      );
    }

    const prepared = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.operatorRun.updateMany({
        where: { id: runId, userId, status: "AWAITING_CLARIFICATION" },
        data: {
          status: "PLANNING",
          continueClientRequestId: input.clientRequestId,
          plannerClientRequestId: randomUUID(),
          plannerOutput: null,
          assistantMessageId: null,
        },
      });

      if (claimed.count === 0) {
        const current = await tx.operatorRun.findFirst({
          where: { id: runId, userId },
          include: { steps: { orderBy: { sequence: "asc" } } },
        });
        if (!current) {
          throw new NotFoundException("Operator run was not found");
        }
        if (current.continueClientRequestId === input.clientRequestId) {
          return { replay: true as const, run: current, previousClarification: current.clarificationQuestion };
        }
        throw new OperatorError("CLARIFICATION_REQUIRED", "This run is not waiting for clarification");
      }

      await tx.operatorRunStep.deleteMany({ where: { runId } });
      const current = await tx.operatorRun.findUniqueOrThrow({ where: { id: runId } });
      if (current.invocationScope !== "DIRECT_CHAT") {
        await tx.message.create({
          data: {
            conversationId: current.conversationId,
            role: "USER",
            content: input.content,
            status: "COMPLETE",
          },
        });
      }
      const updated = await tx.operatorRun.update({
        where: { id: runId },
        data: {
          userText: `${current.userText}\n${input.content}`,
          clarificationQuestion: null,
        },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
      return { replay: false as const, run: updated, previousClarification: current.clarificationQuestion };
    });

    if (prepared.replay) {
      return this.toView(prepared.run, null);
    }
    return this.planAndMaybeExecute(prepared.run, correlationId, prepared.previousClarification);
  }

  async cancelRun(userId: string, runId: string): Promise<OperatorRunView> {
    this.assertEnabled();
    const updated = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "operator_run"
        WHERE "id" = ${runId} AND "userId" = ${userId}
        FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new NotFoundException("Operator run was not found");
      }

      const current = await tx.operatorRun.findUniqueOrThrow({
        where: { id: runId },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });

      // Cancellation is only actionable while the run is waiting for
      // explicit user confirmation. Once execution has started (or the run
      // is terminal), rewriting it as CANCELED can contradict a committed
      // tool side effect. The row lock serializes this decision with
      // acceptConfirmation(), which uses the same operator_run lock.
      if (current.status !== "AWAITING_CONFIRMATION") {
        return current;
      }

      await tx.operatorRunStep.updateMany({
        where: {
          runId: current.id,
          status: {
            in: [
              "PENDING",
              "NEEDS_CONFIRMATION",
              "CONFIRMED",
            ],
          },
        },
        data: { status: "SKIPPED" },
      });
      return tx.operatorRun.update({
        where: { id: current.id },
        data: {
          status: "CANCELED",
          confirmationTokenHash: null,
          confirmationExpiresAt: null,
        },
        include: {
          steps: { orderBy: { sequence: "asc" } },
        },
      });
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
    const snapshot =
      run.invocationScope === "DIRECT_CHAT"
        ? {
            timezone: context.timezone,
            locale: context.locale,
            tasks: [],
            reminders: [],
            notes: [],
            lists: [],
          }
        : await loadWorkspaceSnapshot(context);
    let effectiveUntrustedContext = untrustedContext;
    if (run.invocationScope === "DIRECT_CHAT") {
      try {
        effectiveUntrustedContext =
          await this.loadFrozenDirectChatContext(run);
      } catch (error: unknown) {
        if (
          error instanceof OperatorError &&
          error.code === "CONTEXT_REVOKED"
        ) {
          return this.failDirectChatContextRevoked(run);
        }
        throw error;
      }
    }
    const invocationScope =
      run.invocationScope === "DIRECT_CHAT" ? "DIRECT_CHAT" : "PERSONAL";
    const prompt = buildPlannerPrompt({
      userText: run.userText,
      locale: run.locale,
      snapshot,
      previousClarification,
      invocationScope,
      participantNames: context.invocation.participantNames,
      untrustedContext: effectiveUntrustedContext,
    });
    const trustedPrompt =
      invocationScope === "DIRECT_CHAT"
        ? buildPlannerPrompt({
            userText: run.userText,
            locale: run.locale,
            snapshot,
            previousClarification,
            invocationScope,
            participantNames: context.invocation.participantNames,
            untrustedContext: null,
          })
        : prompt;

    let plannerOutput = run.plannerOutput;
    if (!plannerOutput) {
      if (this.config.appEnv !== "local" && this.config.appEnv !== "test") {
        return this.failRun(
          run.id,
          "vimla_core_unavailable",
          "Vimla Core is not enabled for this environment yet.",
        );
      }

      const plannerClientRequestId = run.plannerClientRequestId ?? randomUUID();
      const trustedPlannerOutput = mockOperatorPlannerResponse([
        { content: trustedPrompt },
      ]);
      const proposedPlannerOutput =
        invocationScope === "DIRECT_CHAT" &&
        effectiveUntrustedContext
          ? selectDirectChatPlannerOutput(
              trustedPlannerOutput,
              mockOperatorPlannerResponse([{ content: prompt }]),
            )
          : trustedPlannerOutput;
      const published = await this.prisma.operatorRun.updateMany({
        where: {
          id: run.id,
          status: "PLANNING",
          plannerOutput: null,
        },
        data: {
          plannerOutput: proposedPlannerOutput,
          plannerAiRequestId: null,
          plannerClientRequestId,
        },
      });
      if (published.count === 1) {
        plannerOutput = proposedPlannerOutput;
      } else {
        const current = await this.prisma.operatorRun.findUniqueOrThrow({
          where: { id: run.id },
          select: { plannerOutput: true },
        });
        if (!current.plannerOutput) {
          return this.toView(await this.loadOwnedRun(run.userId, run.id), null);
        }
        plannerOutput = current.plannerOutput;
      }
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
      steps = prepareSteps(
        plan.commands,
        run.invocationScope === "DIRECT_CHAT" ? "DIRECT_CHAT" : "PERSONAL",
      ).slice(0, this.config.operatorMaxToolsPerRun);
    } catch (error: unknown) {
      if (error instanceof OperatorError) {
        return this.failRun(run.id, "operator_plan_invalid", plan.userMessage);
      }
      throw error;
    }

    const stepsPublished = await this.replaceSteps(
      run.id,
      steps,
    );
    if (!stepsPublished) {
      return this.resumeExisting(
        await this.loadOwnedRun(run.userId, run.id),
        correlationId,
      );
    }

    const confirmationRequired = steps.some((step) => step.confirmationRequired);
    if (confirmationRequired) {
      const token = generateConfirmationToken();
      const transition = await this.prisma.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<
            Array<{ id: string; status: string }>
          >`
            SELECT "id", "status" FROM "operator_run"
            WHERE "id" = ${run.id}
            FOR UPDATE
          `;
          if (locked.length === 0) {
            throw new NotFoundException(
              "Operator run was not found",
            );
          }
          const current =
            await tx.operatorRun.findUniqueOrThrow({
              where: { id: run.id },
              include: {
                steps: { orderBy: { sequence: "asc" } },
              },
            });
          if (current.status !== "PLANNING") {
            return {
              run: current,
              transitioned: false as const,
            };
          }
          const updated = await tx.operatorRun.update({
            where: { id: run.id },
            data: {
              status: "AWAITING_CONFIRMATION",
              publicMessage: sanitizePublicText(
                plan.userMessage,
                2_000,
              ),
              confirmationTokenHash:
                hashConfirmationToken(
                  token,
                  this.config.betterAuthSecret,
                ),
              confirmationExpiresAt: new Date(
                Date.now() +
                  this.config
                    .operatorConfirmationTtlSeconds *
                    1_000,
              ),
            },
            include: {
              steps: { orderBy: { sequence: "asc" } },
            },
          });
          return {
            run: updated,
            transitioned: true as const,
          };
        },
      );
      if (!transition.transitioned) {
        return this.resumeExisting(
          transition.run,
          correlationId,
        );
      }
      await this.persistAssistant(
        transition.run,
        transition.run.publicMessage ?? plan.userMessage,
      );
      this.logger.log({
        msg: "operator.confirm_required",
        operatorRunId: run.id,
        actorUserId: run.userId,
      });
      return this.toView(transition.run, token);
    }

    const executionRun = await this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<
          Array<{ id: string; status: string }>
        >`
          SELECT "id", "status" FROM "operator_run"
          WHERE "id" = ${run.id}
          FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new NotFoundException(
            "Operator run was not found",
          );
        }
        const current =
          await tx.operatorRun.findUniqueOrThrow({
            where: { id: run.id },
            include: {
              steps: { orderBy: { sequence: "asc" } },
            },
          });
        if (current.status !== "PLANNING") {
          return current;
        }
        return tx.operatorRun.update({
          where: { id: run.id },
          data: {
            status: "EXECUTING",
            publicMessage: sanitizePublicText(
              plan.userMessage,
              2_000,
            ),
          },
          include: {
            steps: { orderBy: { sequence: "asc" } },
          },
        });
      },
    );
    if (executionRun.status !== "EXECUTING") {
      return this.resumeExisting(
        executionRun,
        correlationId,
      );
    }
    const executed = await this.executePersistedSteps(run.id, context, correlationId);
    if (executed.status === "CLARIFY") {
      return this.awaitClarification(run.id, executed.publicMessage, executed.question);
    }
    return this.finishRun(run.id, executed.publicMessage || plan.userMessage, executed.status, null);
  }

  private async executePersistedSteps(
    runId: string,
    context: OperatorToolContext,
    correlationId: string,
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

    for (const listedStep of steps) {
      try {
        const outcome = await this.prisma.$transaction(async (tx) => {
          const runLock = await tx.$queryRaw<
            Array<{ id: string; status: string }>
          >`
            SELECT "id", "status" FROM "operator_run"
            WHERE "id" = ${runId}
            FOR UPDATE
          `;
          if (
            runLock.length === 0 ||
            runLock[0]?.status !== "EXECUTING"
          ) {
            return { kind: "skipped" as const };
          }
          await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "operator_run_step"
            WHERE "id" = ${listedStep.id}
            FOR UPDATE
          `;
          const step = await tx.operatorRunStep.findUnique({ where: { id: listedStep.id } });
          if (!step) {
            return { kind: "skipped" as const };
          }
          if (step.status === "EXECUTED") {
            return { kind: "executed" as const, title: step.publicTitle };
          }
          if (step.status === "FAILED") {
            return { kind: "failed" as const };
          }
          if (step.status === "SKIPPED") {
            return { kind: "skipped" as const };
          }
          if (step.status === "NEEDS_CONFIRMATION") {
            return { kind: "failed" as const };
          }
          if (step.status === "CONFIRMED") {
            const acceptance = await tx.operatorAuditEvent.findFirst({
              where: {
                runId,
                operation: "confirmation_accepted",
                objectKind: "operator_step",
                objectId: step.id,
                result: "accepted",
              },
            });
            if (!acceptance) {
              await tx.operatorRunStep.update({
                where: { id: step.id },
                data: { status: "FAILED", errorCode: "operator_reconciliation_required" },
              });
              await tx.operatorAuditEvent.create({
                data: {
                  runId,
                  userId: context.actor.userId,
                  toolName: step.toolName,
                  operation: "reconciliation_required",
                  objectKind: step.publicKind,
                  objectId: step.objectId,
                  result: "operator_reconciliation_required",
                },
              });
              return { kind: "failed" as const };
            }
          }
          if (step.status !== "PENDING" && step.status !== "CONFIRMED") {
            return { kind: "skipped" as const };
          }

          await this.assertDirectChatExecutionConsentTx(
            tx,
            runId,
            context,
          );
          if (
            context.invocation.scope === "DIRECT_CHAT" &&
            step.toolName !== "tasks.create"
          ) {
            throw new OperatorError(
              "TOOL_DENIED",
              "This persisted tool is not available from a Direct Chat",
            );
          }
          const args = asRecord(step.inputJson);
          const txContext = this.transactionalToolContext(context, tx);
          const result = await executeStep(step.toolName, args, txContext);
          await tx.operatorRunStep.update({
            where: { id: step.id },
            data: {
              status: "EXECUTED",
              publicTitle: result.card.title,
              publicDetail: result.card.detail,
              publicNavigationTarget: result.card.navigationTarget as Prisma.InputJsonValue,
              publicKind: result.card.kind,
              objectId: result.objectId,
              executedAt: new Date(),
              errorCode: null,
            },
          });
          await tx.operatorAuditEvent.create({
            data: {
              runId,
              userId: context.actor.userId,
              toolName: step.toolName,
              operation: result.card.operation,
              objectKind: result.card.kind,
              objectId: result.objectId,
              result: "ok",
            },
          });
          return { kind: "executed" as const, title: result.card.title };
        });

        if (outcome.kind === "executed") {
          executed += 1;
          titles.push(outcome.title);
        } else if (outcome.kind === "failed") {
          failed += 1;
        }
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
        const terminal = await this.markStepFailed(listedStep.id, runId, context.actor.userId, code);
        if (terminal === "EXECUTED") {
          executed += 1;
          const latest = await this.prisma.operatorRunStep.findUnique({ where: { id: listedStep.id } });
          if (latest) {
            titles.push(latest.publicTitle);
          }
        } else {
          failed += 1;
        }
        this.logger.warn({
          msg: "operator.step_failed",
          operatorRunId: runId,
          actorUserId: context.actor.userId,
          toolName: listedStep.toolName,
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

  private async markStepFailed(
    stepId: string,
    runId: string,
    userId: string,
    code: string,
  ): Promise<"FAILED" | "EXECUTED"> {
    return this.prisma.$transaction(async (tx) => {
      const runLock = await tx.$queryRaw<
        Array<{ id: string; status: string }>
      >`
        SELECT "id", "status" FROM "operator_run"
        WHERE "id" = ${runId}
        FOR UPDATE
      `;
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "operator_run_step"
        WHERE "id" = ${stepId}
        FOR UPDATE
      `;
      const step = await tx.operatorRunStep.findUnique({ where: { id: stepId } });
      if (step?.status === "EXECUTED") {
        return "EXECUTED" as const;
      }
      if (
        !step ||
        step.status === "FAILED" ||
        runLock.length === 0 ||
        runLock[0]?.status !== "EXECUTING"
      ) {
        return "FAILED" as const;
      }
      await tx.operatorRunStep.update({
        where: { id: step.id },
        data: { status: "FAILED", errorCode: code },
      });
      await tx.operatorAuditEvent.create({
        data: {
          runId,
          userId,
          toolName: step.toolName,
          operation: "failed",
          objectKind: step.publicKind,
          objectId: step.objectId,
          result: code,
        },
      });
      return "FAILED" as const;
    });
  }

  private transactionalToolContext(
    context: OperatorToolContext,
    tx: Prisma.TransactionClient,
  ): OperatorToolContext {
    return {
      ...context,
      services: {
        tasks: new TaskService(tx),
        reminders: new ReminderService(tx),
        lists: new ListService(tx),
        notes: new NoteService(tx),
        today: new WorkspaceTodayService(tx),
        notifications: new NotificationPreferenceService(tx),
        getSafeProfile: (id) => this.getSafeProfileFromDb(tx, id),
      },
    };
  }

  private async finishRun(
    runId: string,
    publicMessage: string,
    status: "SUCCEEDED" | "PARTIAL" | "FAILED",
    confirmationToken: string | null,
  ): Promise<OperatorRunView> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ id: string; status: string }>
      >`
        SELECT "id", "status" FROM "operator_run"
        WHERE "id" = ${runId}
        FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new NotFoundException("Operator run was not found");
      }
      const current = await tx.operatorRun.findUniqueOrThrow({
        where: { id: runId },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
      if (
        isTerminalOperatorRunStatus(current.status) ||
        current.status !== "EXECUTING"
      ) {
        return current;
      }

      const failedStep =
        status === "FAILED"
          ? current.steps.find(
              (step) =>
                step.status === "FAILED" &&
                step.errorCode !== null,
            )
          : null;
      return tx.operatorRun.update({
        where: { id: runId },
        data: {
          status,
          publicMessage: sanitizePublicText(publicMessage, 2_000),
          errorCode:
            status === "FAILED"
              ? failedStep?.errorCode ?? "operator_plan_invalid"
              : null,
          confirmationTokenHash: null,
          confirmationExpiresAt: null,
        },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
    });
    await this.persistAssistant(updated, updated.publicMessage ?? publicMessage);
    this.logger.log({
      msg: "operator.finished",
      operatorRunId: runId,
      actorUserId: updated.userId,
      status: updated.status,
    });
    return this.toView(
      updated,
      updated.status === "AWAITING_CONFIRMATION"
        ? confirmationToken
        : null,
    );
  }

  private async succeedWithoutTools(runId: string, message: string): Promise<OperatorRunView> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ id: string; status: string }>
      >`
        SELECT "id", "status" FROM "operator_run"
        WHERE "id" = ${runId}
        FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new NotFoundException("Operator run was not found");
      }
      const current = await tx.operatorRun.findUniqueOrThrow({
        where: { id: runId },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
      if (
        isTerminalOperatorRunStatus(current.status) ||
        (current.status !== "PLANNING" &&
          current.status !== "CREATED")
      ) {
        return current;
      }
      return tx.operatorRun.update({
        where: { id: runId },
        data: {
          status: "SUCCEEDED",
          publicMessage: sanitizePublicText(message, 2_000),
          errorCode: null,
          confirmationTokenHash: null,
          confirmationExpiresAt: null,
        },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
    });
    if (updated.status === "SUCCEEDED") {
      await this.persistAssistant(
        updated,
        updated.publicMessage ?? message,
      );
    }
    return this.toView(updated, null);
  }

  private async awaitClarification(runId: string, message: string, question: string): Promise<OperatorRunView> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ id: string; status: string }>
      >`
        SELECT "id", "status" FROM "operator_run"
        WHERE "id" = ${runId}
        FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new NotFoundException("Operator run was not found");
      }
      const current = await tx.operatorRun.findUniqueOrThrow({
        where: { id: runId },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
      if (
        isTerminalOperatorRunStatus(current.status) ||
        (current.status !== "EXECUTING" &&
          current.status !== "PLANNING")
      ) {
        return current;
      }
      return tx.operatorRun.update({
        where: { id: runId },
        data: {
          status: "AWAITING_CLARIFICATION",
          publicMessage: sanitizePublicText(message, 2_000),
          clarificationQuestion: sanitizePublicText(question, 500),
        },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
    });
    if (updated.status === "AWAITING_CLARIFICATION") {
      await this.persistAssistant(
        updated,
        `${updated.publicMessage ?? message}\n${updated.clarificationQuestion ?? question}`,
      );
    }
    return this.toView(updated, null);
  }

  private async failRun(runId: string, errorCode: string, message: string): Promise<OperatorRunView> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ id: string; status: string }>
      >`
        SELECT "id", "status" FROM "operator_run"
        WHERE "id" = ${runId}
        FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new NotFoundException("Operator run was not found");
      }
      const current = await tx.operatorRun.findUniqueOrThrow({
        where: { id: runId },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
      if (
        isTerminalOperatorRunStatus(current.status) ||
        (current.status !== "CREATED" &&
          current.status !== "PLANNING")
      ) {
        return current;
      }
      return tx.operatorRun.update({
        where: { id: runId },
        data: {
          status: "FAILED",
          errorCode,
          publicMessage: sanitizePublicText(message, 2_000),
          confirmationTokenHash: null,
          confirmationExpiresAt: null,
        },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
    });
    if (updated.status === "FAILED") {
      await this.persistAssistant(
        updated,
        updated.publicMessage ?? message,
      );
    }
    return this.toView(updated, null);
  }

  private async replaceSteps(
    runId: string,
    steps: PreparedStep[],
  ): Promise<boolean> {
    if (steps.length === 0) {
      return true;
    }
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ id: string; status: string }>
      >`
        SELECT "id", "status" FROM "operator_run"
        WHERE "id" = ${runId}
        FOR UPDATE
      `;
      if (
        locked.length === 0 ||
        locked[0]?.status !== "PLANNING"
      ) {
        return false;
      }
      await tx.operatorRunStep.createMany({
        data: steps.map((step) => ({
          runId,
          sequence: step.sequence,
          toolName: step.toolName,
          status: step.confirmationRequired
            ? "NEEDS_CONFIRMATION"
            : "PENDING",
          inputJson: step.args as Prisma.InputJsonValue,
          publicKind: step.card.kind,
          publicTitle: step.card.title,
          publicDetail: step.card.detail,
          publicNavigationTarget: step.card.navigationTarget as Prisma.InputJsonValue,
          idempotencyKey: step.idempotencyKey,
        })),
        skipDuplicates: true,
      });
      return true;
    });
  }

  private async persistAssistant(
    run: { id: string; conversationId: string; assistantMessageId: string | null; invocationScope?: string | null },
    content: string,
  ): Promise<void> {
    const text = sanitizePublicText(content, 2_000) || "Done.";
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "operator_run"
        WHERE "id" = ${run.id}
        FOR UPDATE
      `;
      const current = await tx.operatorRun.findUnique({ where: { id: run.id } });
      if (!current || current.invocationScope === "DIRECT_CHAT") {
        return;
      }
      if (current.assistantMessageId) {
        await tx.message.update({
          where: { id: current.assistantMessageId },
          data: { content: text, operatorRunId: current.id, status: "COMPLETE" },
        });
        return;
      }
      const message = await tx.message.create({
        data: {
          conversationId: current.conversationId,
          role: "ASSISTANT",
          content: text,
          status: "COMPLETE",
          operatorRunId: current.id,
        },
      });
      await tx.operatorRun.update({
        where: { id: current.id },
        data: { assistantMessageId: message.id },
      });
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
    directSourceMessageId: string | undefined,
    contextBundle:
      | {
          messages: Array<{
            messageId: string;
            senderUserId: string;
            sentAt: string;
            text: string;
          }>;
        }
      | undefined,
  ): Promise<{
    directConversationId: string | null;
    sourceMessageId: string | null;
    sourceMessageCreatedAt: string | null;
    messages: Array<{
      messageId: string;
      senderUserId: string;
      sentAt: string;
      text: string;
    }>;
    ownIncluded: boolean;
    peerIncluded: boolean;
    peerDenied: boolean;
    untrustedContext: string | null;
  }> {
    if (scope !== "DIRECT_CHAT") {
      return {
        directConversationId: null,
        sourceMessageId: null,
        sourceMessageCreatedAt: null,
        messages: [],
        ownIncluded: false,
        peerIncluded: false,
        peerDenied: false,
        untrustedContext: null,
      };
    }
    if (!directConversationId || !directSourceMessageId) {
      throw new OperatorError(
        "VALIDATION_ERROR",
        "Direct Chat invocation provenance is required",
      );
    }
    await this.assertDirectChatSurfaceAuthority(
      userId,
      directConversationId,
    );
    const disclosure =
      await this.directChats.chats.validateOperatorContextDisclosure(
        userId,
        directConversationId,
        directSourceMessageId,
        contextBundle?.messages ?? [],
      );
    return {
      directConversationId,
      sourceMessageId: disclosure.sourceMessageId,
      sourceMessageCreatedAt: disclosure.sourceMessageCreatedAt,
      messages: disclosure.messages,
      ownIncluded: disclosure.ownIncluded,
      peerIncluded: disclosure.peerIncluded,
      peerDenied: disclosure.peerDenied,
      untrustedContext: this.formatDirectChatContext(
        userId,
        disclosure.messages,
      ),
    };
  }

  private async assertDirectChatSurfaceAuthority(
    userId: string,
    directConversationId: string,
  ): Promise<void> {
    const surface =
      await this.prisma.communicationSurface.findUnique({
        where: { directConversationId },
        select: { id: true },
      });
    if (!surface) {
      throw new OperatorError(
        "CONTEXT_REVOKED",
        "Direct Chat surface is unavailable",
      );
    }

    try {
      const authority =
        await createSurfaceAuthorityRegistry(
          this.prisma,
        ).resolve({
          actorUserId: userId,
          surfaceId: surface.id,
        });
      if (
        authority.kind !== "DIRECT" ||
        authority.domainId !== directConversationId ||
        !authority.canRead ||
        !authority.canContribute ||
        !authority.capabilities.includes(
          "CONTEXT_READ",
        ) ||
        !authority.capabilities.includes(
          "ACTION_INVOKE",
        ) ||
        authority.disclosurePolicy
          .serverPlaintextAvailable ||
        !authority.disclosurePolicy
          .clientDisclosureRequired ||
        !authority.disclosurePolicy
          .peerContentRequiresConsent
      ) {
        throw new OperatorError(
          "CONTEXT_REVOKED",
          "Direct Chat surface authority is unavailable",
        );
      }
    } catch (error: unknown) {
      if (
        error instanceof SurfaceIdentityUnavailableError ||
        error instanceof SurfaceAuthorityUnavailableError ||
        error instanceof SurfaceAccessDeniedError
      ) {
        throw new OperatorError(
          "CONTEXT_REVOKED",
          "Direct Chat surface authority is unavailable",
        );
      }
      throw error;
    }
  }

  private async loadFrozenDirectChatContext(
    run: RunRecord,
  ): Promise<string | null> {
    if (
      run.invocationScope !== "DIRECT_CHAT" ||
      !run.directConversationId
    ) {
      return null;
    }
    const frozen = await loadDirectOperatorContextSnapshot(
      this.prisma,
      run.userId,
      run.id,
    );
    if (!frozen) {
      throw new OperatorError(
        "CONTEXT_REVOKED",
        "Direct Chat context snapshot is unavailable",
      );
    }
    let disclosure;
    try {
      await this.assertDirectChatSurfaceAuthority(
        run.userId,
        run.directConversationId,
      );
      disclosure =
        await this.directChats.chats.validateOperatorContextDisclosure(
          run.userId,
          run.directConversationId,
          frozen.sourceMessageId,
          frozen.messages,
        );
    } catch (error: unknown) {
      if (
        error instanceof DirectChatError ||
        (error instanceof OperatorError &&
          error.code === "CONTEXT_REVOKED")
      ) {
        throw new OperatorError(
          "CONTEXT_REVOKED",
          "Direct Chat context is no longer authorized",
        );
      }
      throw error;
    }
    const authorizedIds = new Set(
      disclosure.messages.map((message) => message.messageId),
    );
    if (
      disclosure.sourceMessageCreatedAt !==
        frozen.sourceMessageCreatedAt ||
      disclosure.messages.length !== frozen.messages.length ||
      frozen.messages.some(
        (message) => !authorizedIds.has(message.messageId),
      )
    ) {
      throw new OperatorError(
        "CONTEXT_REVOKED",
        "Direct Chat context permission changed",
      );
    }
    return this.formatDirectChatContext(run.userId, disclosure.messages);
  }

  private async failIfDirectChatContextRevoked(
    run: RunRecord,
  ): Promise<OperatorRunView | null> {
    if (run.invocationScope !== "DIRECT_CHAT") {
      return null;
    }
    try {
      await this.loadFrozenDirectChatContext(run);
      return null;
    } catch (error: unknown) {
      if (
        error instanceof OperatorError &&
        error.code === "CONTEXT_REVOKED"
      ) {
        return this.failDirectChatContextRevoked(run);
      }
      throw error;
    }
  }

  private async failDirectChatContextRevoked(
    run: RunRecord,
  ): Promise<OperatorRunView> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "operator_run"
        WHERE "id" = ${run.id} AND "userId" = ${run.userId}
        FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new NotFoundException("Operator run was not found");
      }

      const current = await tx.operatorRun.findUniqueOrThrow({
        where: { id: run.id },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
      if (isTerminalOperatorRunStatus(current.status)) {
        return current;
      }

      const unfinishedStatuses = [
        "PENDING",
        "NEEDS_CONFIRMATION",
        "CONFIRMED",
      ];
      const hasExecuted = current.steps.some(
        (step) => step.status === "EXECUTED",
      );
      const hasExistingFailure = current.steps.some(
        (step) => step.status === "FAILED",
      );
      const hasUnfinished = current.steps.some((step) =>
        unfinishedStatuses.includes(step.status),
      );

      if (hasUnfinished) {
        await tx.operatorRunStep.updateMany({
          where: {
            runId: current.id,
            status: { in: unfinishedStatuses },
          },
          data: {
            status: "FAILED",
            errorCode: "direct_chat_context_revoked",
          },
        });
      }

      // executePersistedSteps() takes the same run row lock before every
      // side effect. If an effect committed before consent was revoked,
      // preserve that durable fact instead of rewriting the whole run as
      // FAILED. Remaining steps become failed and the run becomes PARTIAL.
      const terminalStatus =
        current.status === "EXECUTING" && hasExecuted
          ? hasExistingFailure || hasUnfinished
            ? "PARTIAL"
            : "SUCCEEDED"
          : "FAILED";
      const publicMessage =
        terminalStatus === "SUCCEEDED"
          ? current.publicMessage ?? "Done."
          : terminalStatus === "PARTIAL"
            ? "Some actions completed, others failed."
            : "Direct Chat context permission changed. Invoke @Vimla again.";

      return tx.operatorRun.update({
        where: { id: current.id },
        data: {
          status: terminalStatus,
          publicMessage: sanitizePublicText(publicMessage, 2_000),
          errorCode:
            terminalStatus === "FAILED"
              ? "direct_chat_context_revoked"
              : null,
          confirmationTokenHash: null,
          confirmationExpiresAt: null,
        },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
    });
    return this.toView(updated, null);
  }

  private async assertDirectChatExecutionConsentTx(
    tx: Prisma.TransactionClient,
    runId: string,
    context: OperatorToolContext,
  ): Promise<void> {
    if (context.invocation.scope !== "DIRECT_CHAT") {
      return;
    }
    const directConversationId = context.invocation.directConversationId;
    if (!directConversationId) {
      throw new OperatorError(
        "CONTEXT_REVOKED",
        "Direct Chat context is unavailable",
      );
    }

    const snapshot = await tx.contextSnapshot.findUnique({
      where: { operatorRunId: runId },
      include: { items: { orderBy: { sequence: "asc" } } },
    });
    if (!snapshot) {
      throw new OperatorError(
        "CONTEXT_REVOKED",
        "Direct Chat context snapshot is unavailable",
      );
    }
    const messages: Array<{ senderUserId: string }> = [];
    for (const item of snapshot.items) {
      if (item.sourceType !== "E2EE_DISCLOSURE") continue;
      const metadata = asRecord(item.metadata);
      if (metadata.disclosureKind !== "L1_RAW") continue;
      const senderUserId =
        typeof metadata.senderUserId === "string"
          ? metadata.senderUserId
          : null;
      if (!senderUserId) {
        throw new OperatorError(
          "CONTEXT_REVOKED",
          "Direct Chat context provenance is invalid",
        );
      }
      messages.push({ senderUserId });
    }
    await this.assertDirectChatDisclosureConsentTx(
      tx,
      directConversationId,
      context.actor.userId,
      messages,
    );
  }

  private async assertDirectChatDisclosureConsentTx(
    tx: Prisma.TransactionClient,
    directConversationId: string,
    actorUserId: string,
    messages: readonly { senderUserId: string }[],
  ): Promise<void> {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "direct_conversation_member"
      WHERE "conversationId" = ${directConversationId}
      ORDER BY "id"
      FOR SHARE
    `;
    const members = await tx.directConversationMember.findMany({
      where: { conversationId: directConversationId },
      select: {
        userId: true,
        shareOwnHistoryWithVimla: true,
        includePeerHistoryWhenInvoking: true,
      },
    });
    const mine = members.find((member) => member.userId === actorUserId);
    const peer = members.find((member) => member.userId !== actorUserId);
    if (!mine || !peer) {
      throw new OperatorError(
        "CONTEXT_REVOKED",
        "Direct Chat membership changed",
      );
    }

    for (const message of messages) {
      if (message.senderUserId === actorUserId) {
        if (!mine.shareOwnHistoryWithVimla) {
          throw new OperatorError(
            "CONTEXT_REVOKED",
            "Direct Chat self-history consent was revoked",
          );
        }
        continue;
      }
      if (
        message.senderUserId !== peer.userId ||
        !mine.includePeerHistoryWhenInvoking ||
        !peer.shareOwnHistoryWithVimla
      ) {
        throw new OperatorError(
          "CONTEXT_REVOKED",
          "Direct Chat peer-history consent was revoked",
        );
      }
    }
  }

  private formatDirectChatContext(
    userId: string,
    messages: readonly {
      senderUserId: string;
      sentAt: string;
      text: string;
    }[],
  ): string | null {
    if (messages.length === 0) return null;
    return messages
      .map(
        (message) =>
          `${message.senderUserId === userId ? "self" : "peer"} at ${message.sentAt}: ${message.text}`,
      )
      .join("\n");
  }

  private async getSafeProfile(userId: string): Promise<SafeProfile> {
    return this.getSafeProfileFromDb(this.prisma, userId);
  }

  private async getSafeProfileFromDb(
    db: Prisma.TransactionClient | PrismaClientLike,
    userId: string,
  ): Promise<SafeProfile> {
    const user = await db.user.findUnique({
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

  private async rotateConfirmationToken(
    runId: string,
  ): Promise<string | null> {
    const token = generateConfirmationToken();
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ id: string; status: string }>
      >`
        SELECT "id", "status" FROM "operator_run"
        WHERE "id" = ${runId}
        FOR UPDATE
      `;
      if (
        locked.length === 0 ||
        locked[0]?.status !== "AWAITING_CONFIRMATION"
      ) {
        return null;
      }
      await tx.operatorRun.update({
        where: { id: runId },
        data: {
          confirmationTokenHash: hashConfirmationToken(
            token,
            this.config.betterAuthSecret,
          ),
          confirmationExpiresAt: new Date(
            Date.now() +
              this.config.operatorConfirmationTtlSeconds *
                1_000,
          ),
        },
      });
      return token;
    });
  }

  private toView(run: RunRecord, confirmationToken: string | null): OperatorRunView {
    return buildOperatorRunView(run, confirmationToken);
  }

  private async resumeExisting(run: RunRecord, correlationId: string): Promise<OperatorRunView> {
    if (run.status === "CREATED" || run.status === "PLANNING") {
      return this.planAndMaybeExecute(
        run,
        correlationId,
        run.clarificationQuestion,
      );
    }
    if (run.status === "EXECUTING") {
      const context = await this.toolContext(run);
      const executed = await this.executePersistedSteps(run.id, context, correlationId);
      if (executed.status === "CLARIFY") {
        return this.awaitClarification(run.id, executed.publicMessage, executed.question);
      }
      return this.finishRun(run.id, executed.publicMessage, executed.status, null);
    }
    if (run.status === "AWAITING_CONFIRMATION") {
      const contextFailure = await this.failIfDirectChatContextRevoked(run);
      if (contextFailure) {
        return contextFailure;
      }
      const token = await this.rotateConfirmationToken(run.id);
      if (!token) {
        return this.toView(
          await this.loadOwnedRun(run.userId, run.id),
          null,
        );
      }
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
type PrismaClientLike = Pick<Prisma.TransactionClient, "user">;

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
    return error.code === "CONTEXT_REVOKED"
      ? "direct_chat_context_revoked"
      : error.code.toLowerCase();
  }
  return "internal_error";
}

function isTerminalOperatorRunStatus(status: string): boolean {
  return (
    status === "SUCCEEDED" ||
    status === "PARTIAL" ||
    status === "FAILED" ||
    status === "CANCELED"
  );
}

function isUniqueConstraint(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
