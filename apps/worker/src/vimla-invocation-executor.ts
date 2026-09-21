import { mockOperatorPlannerResponse } from "@vimla/ai";
import {
  ArtifactBindingError,
  ArtifactNotFoundError,
  ArtifactService,
  ArtifactValidationError,
} from "@vimla/artifacts";
import { type Prisma, type PrismaClient } from "@vimla/database";
import { NotificationPlatformError, NotificationPreferenceService } from "@vimla/notifications";
import {
  OperatorError,
  buildPlannerPrompt,
  executeStep,
  loadWorkspaceSnapshot,
  parsePlannerOutput,
  prepareSteps,
  type OperatorToolContext,
  type PlannerPlan,
  type SafeProfile,
  type TaskOwnerResolution,
  type WorkspaceSnapshot,
} from "@vimla/operator";
import { parseVimlaLocale, type VimlaLocale } from "@vimla/shared";
import {
  ListService,
  NoteService,
  ReminderService,
  TaskService,
  WorkspaceError,
  WorkspaceTodayService,
} from "@vimla/workspace";
import type {
  InvocationExecutionInput,
  InvocationExecutionResult,
  InvocationExecutorRegistry,
} from "./orchestration.js";

export interface VimlaToolPlannerInput {
  userText: string;
  locale: VimlaLocale;
  snapshot: WorkspaceSnapshot;
  dependencyContext: string | null;
}

export interface VimlaToolPlanner {
  plan(input: VimlaToolPlannerInput): Promise<PlannerPlan>;
}

/**
 * Local/test planner adapter. It keeps PR-08 focused on converting the existing
 * typed Operator tool stack into an orchestration executor. Production semantic
 * workflow planning remains PR-11.
 */
export class DeterministicVimlaToolPlanner implements VimlaToolPlanner {
  async plan(input: VimlaToolPlannerInput): Promise<PlannerPlan> {
    const prompt = buildPlannerPrompt({
      userText: input.userText,
      locale: input.locale,
      snapshot: input.snapshot,
      invocationScope: "PERSONAL",
      untrustedContext: input.dependencyContext,
    });
    return parsePlannerOutput(mockOperatorPlannerResponse([{ content: prompt }]));
  }
}

export class VimlaAwareInvocationExecutorRegistry implements InvocationExecutorRegistry {
  constructor(
    private readonly vimla: VimlaInvocationExecutor,
    private readonly fallback: InvocationExecutorRegistry,
  ) {}

  execute(input: InvocationExecutionInput): Promise<InvocationExecutionResult> {
    return input.target.kind === "VIMLA"
      ? this.vimla.execute(input)
      : this.fallback.execute(input);
  }
}

export class VimlaInvocationExecutor implements InvocationExecutorRegistry {
  private readonly artifacts: ArtifactService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly planner: VimlaToolPlanner,
    private readonly defaultLocale: VimlaLocale,
  ) {
    this.artifacts = new ArtifactService(prisma);
  }

  async execute(input: InvocationExecutionInput): Promise<InvocationExecutionResult> {
    if (input.target.kind !== "VIMLA") {
      return {
        status: "FAILED",
        errorCode: "VIMLA_EXECUTOR_TARGET_MISMATCH",
        retryable: false,
      };
    }

    const invocation = await this.prisma.invocation.findFirst({
      where: { id: input.invocationId, planId: input.planId },
      include: {
        plan: {
          select: {
            userId: true,
            conversationId: true,
            messageId: true,
          },
        },
      },
    });
    if (!invocation) {
      return {
        status: "FAILED",
        errorCode: "VIMLA_INVOCATION_NOT_FOUND",
        retryable: false,
      };
    }

    const existing = await this.prisma.toolExecution.findUnique({
      where: { idempotencyKey: vimlaToolIdempotencyKey(input.invocationId) },
    });
    if (existing?.status === "COMPLETED") {
      return { status: "COMPLETED", outcome: "REPLAYED" };
    }
    if (existing) {
      return {
        status: "FAILED",
        errorCode: "VIMLA_TOOL_EXECUTION_IN_PROGRESS",
        retryable: true,
      };
    }

    try {
      const profile = await this.loadProfile(invocation.plan.userId);
      const snapshotContext = this.toolContext(this.prisma, {
        userId: invocation.plan.userId,
        conversationId: invocation.plan.conversationId,
        messageId: invocation.plan.messageId,
        locale: profile.locale,
        timezone: profile.timezone,
      });
      const snapshot = await loadWorkspaceSnapshot(snapshotContext);
      const dependencyContext = await this.buildDependencyContext(
        invocation.plan.userId,
        input.invocationId,
      );
      const planned = await this.planner.plan({
        userText: invocation.purpose,
        locale: profile.locale,
        snapshot,
        dependencyContext,
      });

      if (planned.intent === "answer") {
        if (invocation.riskClass !== "READ_ONLY") {
          return {
            status: "FAILED",
            errorCode: "VIMLA_ACTION_NOT_RESOLVED",
            retryable: false,
          };
        }
        return { status: "COMPLETED", outcome: "NO_ACTION" };
      }
      if (planned.intent === "clarify") {
        return {
          status: "FAILED",
          errorCode: "VIMLA_CLARIFICATION_REQUIRED",
          retryable: false,
        };
      }
      if (planned.intent === "refuse") {
        return {
          status: "FAILED",
          errorCode: "VIMLA_REQUEST_REFUSED",
          retryable: false,
        };
      }

      const steps = prepareSteps(planned.commands);
      if (steps.length !== 1) {
        return {
          status: "FAILED",
          errorCode: "VIMLA_INVOCATION_REQUIRES_SINGLE_TOOL",
          retryable: false,
        };
      }
      const step = steps[0];
      if (!step) {
        return {
          status: "FAILED",
          errorCode: "VIMLA_INVOCATION_REQUIRES_SINGLE_TOOL",
          retryable: false,
        };
      }
      if (
        step.confirmationRequired &&
        invocation.approvalPolicy === "AUTO"
      ) {
        return {
          status: "FAILED",
          errorCode: "VIMLA_CONFIRMATION_REQUIRED",
          retryable: false,
        };
      }

      await this.executeToolExactlyOnce(input, invocation.plan, step);
      return { status: "COMPLETED", outcome: "PASS" };
    } catch (error: unknown) {
      return classifyVimlaExecutionError(error);
    }
  }

  private async executeToolExactlyOnce(
    input: InvocationExecutionInput,
    plan: { userId: string; conversationId: string; messageId: string },
    step: {
      toolName: string;
      args: Record<string, unknown>;
    },
  ): Promise<void> {
    const key = vimlaToolIdempotencyKey(input.invocationId);

    try {
      await this.prisma.$transaction(async (tx) => {
        const replay = await tx.toolExecution.findUnique({
          where: { idempotencyKey: key },
        });
        if (replay?.status === "COMPLETED") {
          return;
        }
        if (replay) {
          throw new RetryableVimlaExecutionError("Existing tool execution is not terminal");
        }

        await tx.toolExecution.create({
          data: {
            invocationRunId: input.runId,
            toolName: step.toolName,
            idempotencyKey: key,
            status: "RUNNING",
          },
        });

        const profile = await this.loadProfileFromDb(tx, plan.userId);
        const context = this.toolContext(tx, {
          userId: plan.userId,
          conversationId: plan.conversationId,
          messageId: plan.messageId,
          locale: profile.locale,
          timezone: profile.timezone,
        });
        const result = await executeStep(step.toolName, step.args, context);

        await tx.toolExecution.update({
          where: { idempotencyKey: key },
          data: {
            status: "COMPLETED",
            objectType: result.card.kind.toUpperCase(),
            objectId: result.objectId,
            resultJson: {
              card: result.card,
            } as Prisma.InputJsonValue,
          },
        });
      });
    } catch (error: unknown) {
      if (isUniqueConstraint(error)) {
        const replay = await this.prisma.toolExecution.findUnique({
          where: { idempotencyKey: key },
        });
        if (replay?.status === "COMPLETED") {
          return;
        }
      }
      throw error;
    }
  }

  private async buildDependencyContext(
    userId: string,
    invocationId: string,
  ): Promise<string | null> {
    const bindings = await this.artifacts.resolveInputBindings({
      actorUserId: userId,
      targetInvocationId: invocationId,
    });
    if (bindings.length === 0) return null;

    const parts: string[] = [];
    for (const binding of bindings) {
      const version = await this.artifacts.readVersion({
        actorUserId: userId,
        artifactVersionId: binding.reference.artifactVersionId,
      });
      if (version.content.kind !== "INLINE_JSON") {
        throw new ArtifactBindingError(
          `Vimla input ${JSON.stringify(binding.inputName)} is not inline content`,
        );
      }
      const value = JSON.stringify(version.content.value);
      parts.push(
        [
          `INPUT ${binding.inputName}`,
          `type=${binding.expectedType}`,
          `sourceInvocationId=${binding.sourceInvocationId}`,
          `value=${value}`,
        ].join("\n"),
      );
    }

    const context = parts.join("\n\n");
    if (new TextEncoder().encode(context).byteLength > 65_536) {
      throw new ArtifactValidationError(
        "Vimla dependency artifact context exceeds the execution bound",
      );
    }
    return context;
  }

  private toolContext(
    db: PrismaClient | Prisma.TransactionClient,
    input: {
      userId: string;
      conversationId: string;
      messageId: string;
      locale: VimlaLocale;
      timezone: string | null;
    },
  ): OperatorToolContext {
    return {
      actor: { userId: input.userId },
      source: {
        conversationId: input.conversationId,
        messageId: input.messageId,
      },
      timezone: input.timezone,
      locale: input.locale,
      defaultLocale: this.defaultLocale,
      now: new Date(),
      services: {
        tasks: new TaskService(db),
        reminders: new ReminderService(db),
        lists: new ListService(db),
        notes: new NoteService(db),
        today: new WorkspaceTodayService(db),
        notifications: new NotificationPreferenceService(db),
        getSafeProfile: (userId) => this.loadSafeProfileFromDb(db, userId),
      },
      invocation: {
        scope: "PERSONAL",
        directConversationId: null,
        participantNames: [],
        contextMessages: [],
        resolveTaskOwner: (hint) => personalTaskOwner(input.userId, hint),
      },
    };
  }

  private async loadProfile(userId: string): Promise<{ locale: VimlaLocale; timezone: string | null }> {
    return this.loadProfileFromDb(this.prisma, userId);
  }

  private async loadProfileFromDb(
    db: PrismaClient | Prisma.TransactionClient,
    userId: string,
  ): Promise<{ locale: VimlaLocale; timezone: string | null }> {
    const user = await db.user.findUnique({
      where: { id: userId },
      include: { preference: true },
    });
    if (!user) {
      throw new OperatorError("NOT_FOUND", "User not found");
    }
    return {
      locale: parseVimlaLocale(user.preference?.locale, this.defaultLocale),
      timezone: user.preference?.timezone ?? null,
    };
  }

  private async loadSafeProfileFromDb(
    db: PrismaClient | Prisma.TransactionClient,
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
      locale: parseVimlaLocale(user.preference?.locale, this.defaultLocale),
      timezone: user.preference?.timezone ?? null,
      emailVerified: user.emailVerified,
    };
  }
}

export function vimlaToolIdempotencyKey(invocationId: string): string {
  return `vimla-invocation:${invocationId}:tool:v1`;
}

function personalTaskOwner(userId: string, hint?: string): TaskOwnerResolution {
  if (
    !hint ||
    ["me", "myself", "мне", "себе", "меня", "я"].includes(
      hint.trim().toLocaleLowerCase("en"),
    )
  ) {
    return {
      type: "ok",
      ownerUserId: userId,
      assignedByUserId: null,
      assignmentSourceType: null,
      assignmentSourceId: null,
    };
  }
  return {
    type: "deny",
    message: "Tasks can only be created for you in this conversation.",
  };
}

function classifyVimlaExecutionError(error: unknown): InvocationExecutionResult {
  if (error instanceof RetryableVimlaExecutionError) {
    return {
      status: "FAILED",
      errorCode: "VIMLA_TOOL_EXECUTION_RETRY",
      retryable: true,
    };
  }
  if (
    error instanceof ArtifactBindingError ||
    error instanceof ArtifactNotFoundError ||
    error instanceof ArtifactValidationError
  ) {
    return {
      status: "FAILED",
      errorCode: "VIMLA_ARTIFACT_CONTEXT_INVALID",
      retryable: false,
    };
  }
  if (error instanceof WorkspaceError) {
    return {
      status: "FAILED",
      errorCode: `WORKSPACE_${error.code}`,
      retryable: false,
    };
  }
  if (error instanceof NotificationPlatformError) {
    return {
      status: "FAILED",
      errorCode: `NOTIFICATION_${error.code}`,
      retryable: false,
    };
  }
  if (error instanceof OperatorError) {
    return {
      status: "FAILED",
      errorCode: `OPERATOR_${error.code}`,
      retryable: false,
    };
  }
  return {
    status: "FAILED",
    errorCode: "VIMLA_EXECUTOR_ERROR",
    retryable: true,
  };
}

class RetryableVimlaExecutionError extends Error {}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
