import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import {
  ArtifactService,
  fingerprintResolvedArtifactInputs,
} from "@vimla/artifacts";
import {
  ContextConflictError,
  ContextNotFoundError,
  ContextSnapshotService,
  type ContextSnapshotView,
} from "@vimla/context";
import { type Prisma } from "@vimla/database";
import {
  SemanticPlannerError,
  SemanticWorkflowPlanner,
  toPlannerInvocationMentions,
  type ResolvedInvocationMentionInput,
  type SemanticPlannerModel,
  type SemanticWorkflowPlannerResult,
} from "@vimla/orchestration";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { PrismaService } from "../persistence/prisma.service.js";
import {
  acceptanceCriteriaSchema,
  approveExecutionPlanRequestSchema,
  artifactTypeSchema,
  createExecutionPlanRequestSchema,
  invocationDependencySchema,
  invocationSchema,
  outputDeclarationSchema,
  resolveHumanEvaluationRequestSchema,
  workflowEvaluationSchema,
  workflowGraphKeySchema,
  workflowInvocationRunStatusSchema,
  type ApproveExecutionPlanRequest,
  type CreateExecutionPlanRequest,
  type DependencyConditionDefinition,
  type ExecutionPlanConversationView,
  type ExecutionPlanDefinition,
  type ExecutionPlanLookupView,
  type ExecutionPlanStatus,
  type ExecutionPlanView,
  type InvocationStatus,
  type ResolveHumanEvaluationRequest,
  type WorkflowInvocationRunStatus,
} from "./contracts.js";
import { initialInvocationStatuses, validateManualExecutionPlan } from "./plan-validation.js";
import {
  applySemanticPlanExecutionPolicy,
  SemanticPlanPolicyError,
} from "./semantic-plan-policy.js";
import { SEMANTIC_PLANNER_MODEL } from "./semantic-planner.adapter.js";
import { semanticPlanningContext } from "./planning-context.js";

export type SemanticPlanMessageResult =
  | { kind: "PLANNING"; planId: string }
  | { kind: "PLANNED"; plan: ExecutionPlanView }
  | { kind: "EXISTING_PLAN"; plan: ExecutionPlanView }
  | {
      kind: "CLARIFICATION_REQUIRED";
      clarificationQuestion: string;
    };

const PLANNING_PENDING_HASH = "planning:pending:v1";
const PLANNING_CLAIM_PREFIX = "planning:claimed:";
const CLARIFICATION_HASH_PREFIX = "clarification:";
const PLANNING_GOAL = "Planning workflow";
const MIN_PLANNING_LEASE_MS = 60_000;
const PLANNING_LEASE_GRACE_MS = 30_000;
const MAX_PLANNING_HEARTBEAT_MS = 15_000;

const ACTIVE_INVOCATION_STATUSES = [
  "PENDING",
  "READY",
  "RUNNING",
  "WAITING_APPROVAL",
  "WAITING_FOR_USAGE_CAPACITY",
  "BLOCKED_INSUFFICIENT_USAGE",
] as const;

@Injectable()
export class OrchestrationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiRuntimeConfig,
    @Inject(SEMANTIC_PLANNER_MODEL)
    private readonly semanticPlannerModel: SemanticPlannerModel,
  ) {}

  async planMessage(
    userId: string,
    messageId: string,
    resolvedMentions: readonly ResolvedInvocationMentionInput[],
    correlationId: string,
    onPlanning?: (planId: string) => void,
  ): Promise<SemanticPlanMessageResult> {
    this.assertPreviewEnabled();

    const sourceMessage = await this.prisma.client.message.findFirst({
      where: {
        id: messageId,
        role: "USER",
        conversation: { userId },
      },
      select: {
        id: true,
        content: true,
        conversationId: true,
      },
    });
    if (!sourceMessage) {
      throw new NotFoundException("Source message not found");
    }

    const plannerMentions = toPlannerInvocationMentions(resolvedMentions);
    if (plannerMentions.length === 0) {
      return {
        kind: "CLARIFICATION_REQUIRED",
        clarificationQuestion:
          "Select @vimla, @auto, or an AI model for this workflow.",
      };
    }

    const shell = await this.ensurePlanningShell(userId, sourceMessage);
    if (shell.status === "PLANNING") {
      onPlanning?.(shell.id);
    }
    if (isClarificationShell(shell)) {
      return {
        kind: "CLARIFICATION_REQUIRED",
        clarificationQuestion: shell.goal,
      };
    }
    if (shell.status !== "PLANNING") {
      return existingSemanticPlanResult(shell);
    }

    const claim = await this.claimPlanningShell(
      userId,
      shell.id,
      correlationId,
    );
    if (!claim.claimed) {
      if (isClarificationShell(claim.plan)) {
        return {
          kind: "CLARIFICATION_REQUIRED",
          clarificationQuestion: claim.plan.goal,
        };
      }
      if (claim.plan.status !== "PLANNING") {
        return existingSemanticPlanResult(claim.plan);
      }
      return { kind: "PLANNING", planId: claim.plan.id };
    }

    const abortController = new AbortController();
    const stopHeartbeat = this.startPlanningHeartbeat(
      userId,
      shell.id,
      claim.claimHash,
      abortController,
    );

    try {
      let snapshot: ContextSnapshotView;
      try {
        snapshot = await this.ensureContextSnapshot(userId, shell.id);
      } catch (error: unknown) {
        if (error instanceof ConflictException) {
          const replay = await this.prisma.client.executionPlan.findFirst({
            where: { id: shell.id, userId },
            include: planInclude,
          });
          if (replay && replay.status !== "PLANNING") {
            return existingSemanticPlanResult(replay);
          }
        }
        await this.failPlanningClaim(userId, shell.id, claim.claimHash);
        throw error;
      }

      const planner = new SemanticWorkflowPlanner(this.semanticPlannerModel);
      let result: SemanticWorkflowPlannerResult;
      try {
        result = await planner.plan({
          userText: sourceMessage.content,
          mentions: plannerMentions,
          planningContext: semanticPlanningContext(snapshot),
          correlationId,
          signal: abortController.signal,
        });
      } catch (error: unknown) {
        if (abortController.signal.aborted) {
          const replay = await this.prisma.client.executionPlan.findFirst({
            where: { id: shell.id, userId },
            include: planInclude,
          });
          if (replay && replay.status !== "PLANNING") {
            return existingSemanticPlanResult(replay);
          }
        }
        await this.failPlanningClaim(userId, shell.id, claim.claimHash);
        if (error instanceof SemanticPlannerError) {
          throw new BadRequestException({
            code: "semantic_plan_invalid",
            message: "The workflow proposal could not be validated safely",
          });
        }
        throw error;
      }

      if (result.kind === "CLARIFY") {
        const question = await this.persistClarification(
          userId,
          shell.id,
          claim.claimHash,
          result.clarificationQuestion,
        );
        return {
          kind: "CLARIFICATION_REQUIRED",
          clarificationQuestion: question,
        };
      }

      let executablePlan: ExecutionPlanDefinition;
      try {
        executablePlan = applySemanticPlanExecutionPolicy(
          result.plan,
        ) as ExecutionPlanDefinition;
        validateManualExecutionPlan(executablePlan);
      } catch (error: unknown) {
        if (error instanceof SemanticPlanPolicyError) {
          const question = await this.persistClarification(
            userId,
            shell.id,
            claim.claimHash,
            error.message,
          );
          return {
            kind: "CLARIFICATION_REQUIRED",
            clarificationQuestion: question,
          };
        }
        await this.failPlanningClaim(userId, shell.id, claim.claimHash);
        throw error;
      }

      try {
        return {
          kind: "PLANNED",
          plan: await this.finalizePlanningShell(
            userId,
            shell.id,
            claim.claimHash,
            executablePlan,
          ),
        };
      } catch (error: unknown) {
        if (error instanceof ConflictException) {
          const replay = await this.prisma.client.executionPlan.findFirst({
            where: { id: shell.id, userId },
            include: planInclude,
          });
          if (replay && replay.status !== "PLANNING") {
            return existingSemanticPlanResult(replay);
          }
        }
        await this.failPlanningClaim(userId, shell.id, claim.claimHash);
        throw error;
      }
    } finally {
      stopHeartbeat();
    }
  }

  private async ensurePlanningShell(
    userId: string,
    sourceMessage: {
      id: string;
      conversationId: string;
    },
  ): Promise<PersistedPlan> {
    const existing = await this.prisma.client.executionPlan.findFirst({
      where: { messageId: sourceMessage.id, userId },
      include: planInclude,
    });
    if (existing) return existing;

    const planId = randomUUID();
    try {
      await this.prisma.client.executionPlan.create({
        data: {
          id: planId,
          messageId: sourceMessage.id,
          userId,
          conversationId: sourceMessage.conversationId,
          schemaVersion: 1,
          version: 1,
          planHash: PLANNING_PENDING_HASH,
          goal: PLANNING_GOAL,
          status: "PLANNING",
          maxParallelism: 1,
        },
      });
    } catch (error: unknown) {
      if (!isUniqueConstraintError(error)) throw error;
    }

    const shell = await this.prisma.client.executionPlan.findFirst({
      where: { messageId: sourceMessage.id, userId },
      include: planInclude,
    });
    if (!shell) {
      throw new ConflictException("Planning shell could not be created");
    }
    return shell;
  }

  private async claimPlanningShell(
    userId: string,
    planId: string,
    correlationId: string,
  ): Promise<{
    claimed: boolean;
    claimHash: string;
    plan: PersistedPlan;
  }> {
    const claimHash = planningClaimHash(planId, correlationId);
    let claimed = await this.prisma.client.executionPlan.updateMany({
      where: {
        id: planId,
        userId,
        status: "PLANNING",
        planHash: PLANNING_PENDING_HASH,
      },
      data: {
        planHash: claimHash,
        goal: PLANNING_GOAL,
      },
    });

    if (claimed.count === 0) {
      const current = await this.prisma.client.executionPlan.findFirst({
        where: { id: planId, userId },
        include: planInclude,
      });
      if (!current) {
        throw new NotFoundException("Execution plan not found");
      }

      const stale =
        current.status === "PLANNING" &&
        current.planHash.startsWith(PLANNING_CLAIM_PREFIX) &&
        current.updatedAt.getTime() <= Date.now() - this.planningLeaseMs();
      if (stale) {
        claimed = await this.prisma.client.executionPlan.updateMany({
          where: {
            id: planId,
            userId,
            status: "PLANNING",
            planHash: current.planHash,
          },
          data: {
            planHash: claimHash,
            goal: PLANNING_GOAL,
          },
        });
      }

      if (claimed.count === 0) {
        const replay = await this.prisma.client.executionPlan.findFirst({
          where: { id: planId, userId },
          include: planInclude,
        });
        if (!replay) {
          throw new NotFoundException("Execution plan not found");
        }
        return { claimed: false, claimHash, plan: replay };
      }
    }

    const plan = await this.prisma.client.executionPlan.findFirst({
      where: { id: planId, userId },
      include: planInclude,
    });
    if (!plan) {
      throw new NotFoundException("Execution plan not found");
    }
    return { claimed: true, claimHash, plan };
  }

  private async failPlanningClaim(
    userId: string,
    planId: string,
    claimHash: string,
  ): Promise<void> {
    await this.prisma.client.executionPlan.updateMany({
      where: {
        id: planId,
        userId,
        status: "PLANNING",
        planHash: claimHash,
      },
      data: {
        status: "FAILED",
        completedAt: new Date(),
      },
    });
  }

  private async persistClarification(
    userId: string,
    planId: string,
    claimHash: string,
    question: string,
  ): Promise<string> {
    const normalizedQuestion = question.trim().slice(0, 4_000);
    const clarificationHash =
      CLARIFICATION_HASH_PREFIX +
      createHash("sha256").update(normalizedQuestion).digest("hex");

    const updated = await this.prisma.client.executionPlan.updateMany({
      where: {
        id: planId,
        userId,
        status: "PLANNING",
        planHash: claimHash,
      },
      data: {
        planHash: clarificationHash,
        goal: normalizedQuestion,
        status: "NEEDS_CLARIFICATION",
        completedAt: new Date(),
      },
    });
    if (updated.count === 1) return normalizedQuestion;

    const replay = await this.prisma.client.executionPlan.findFirst({
      where: { id: planId, userId },
      include: planInclude,
    });
    if (!replay) {
      throw new NotFoundException("Execution plan not found");
    }
    if (isClarificationShell(replay)) return replay.goal;
    if (replay.status !== "PLANNING") {
      throw new ConflictException("Execution plan finished while clarification was being stored");
    }
    throw new ConflictException("Planning ownership changed");
  }

  private async finalizePlanningShell(
    userId: string,
    planId: string,
    claimHash: string,
    plan: ExecutionPlanDefinition,
  ): Promise<ExecutionPlanView> {
    const planHash = hashPlan(plan);
    const finalized = await this.prisma.client.$transaction(async (tx) => {
      const claimed = await tx.executionPlan.updateMany({
        where: {
          id: planId,
          userId,
          status: "PLANNING",
          planHash: claimHash,
        },
        data: {
          schemaVersion: plan.schemaVersion,
          planHash,
          goal: plan.goal,
          status: "PLANNED",
          maxParallelism: plan.maxParallelism,
        },
      });
      if (claimed.count !== 1) return false;

      await tx.invocation.createMany({
        data: plan.invocations.map((invocation, sequence) => ({
          id: invocationDbId(planId, invocation.id),
          planId,
          sequence,
          purpose: invocation.purpose,
          targetKind: invocation.target.kind,
          targetModelSlug:
            invocation.target.kind === "AI_MODEL"
              ? invocation.target.modelSlug
              : null,
          targetAgentId:
            invocation.target.kind === "AGENT"
              ? invocation.target.agentId
              : null,
          outputDeclarations: toJson(invocation.outputs),
          acceptanceCriteria: toJson(invocation.acceptanceCriteria),
          riskClass: invocation.riskClass,
          approvalPolicy: invocation.approvalPolicy,
          failurePolicy: invocation.failurePolicy,
          joinPolicy: invocation.joinPolicy,
          status: "PENDING",
        })),
      });

      if (plan.dependencies.length > 0) {
        await tx.invocationDependency.createMany({
          data: plan.dependencies.map((dependency) => ({
            id: dependencyDbId(planId, dependency.id),
            planId,
            fromInvocationId: invocationDbId(
              planId,
              dependency.fromInvocationId,
            ),
            toInvocationId: invocationDbId(
              planId,
              dependency.toInvocationId,
            ),
            conditionKind: dependency.condition.kind,
            conditionOutcome:
              dependency.condition.kind === "OUTCOME"
                ? dependency.condition.outcome
                : "",
            inputBindings: toJson(dependency.inputBindings),
          })),
        });
      }
      return true;
    });

    const persisted = await this.prisma.client.executionPlan.findFirst({
      where: { id: planId, userId },
      include: planInclude,
    });
    if (!persisted) {
      throw new NotFoundException("Execution plan not found");
    }
    if (!finalized && persisted.planHash !== planHash) {
      throw new ConflictException("A different execution plan won the planning claim");
    }
    return toView(persisted);
  }

  async create(userId: string, body: unknown): Promise<ExecutionPlanView> {
    this.assertPreviewEnabled();
    const input = parseCreate(body);
    validateManualExecutionPlan(input.plan);

    const sourceMessage = await this.prisma.client.message.findFirst({
      where: {
        id: input.messageId,
        role: "USER",
        conversation: { userId },
      },
      select: { id: true, conversationId: true },
    });
    if (!sourceMessage) {
      throw new NotFoundException("Source message not found");
    }

    const planHash = hashPlan(input.plan);
    const existing = await this.prisma.client.executionPlan.findFirst({
      where: { messageId: sourceMessage.id, userId },
      include: planInclude,
    });
    if (existing) {
      const replay = this.resolveCreateReplay(existing, planHash);
      await this.ensureContextSnapshot(userId, existing.id);
      return replay;
    }

    const planId = randomUUID();
    try {
      await this.prisma.client.$transaction(async (tx) => {
        await tx.executionPlan.create({
          data: {
            id: planId,
            messageId: sourceMessage.id,
            userId,
            conversationId: sourceMessage.conversationId,
            schemaVersion: input.plan.schemaVersion,
            version: 1,
            planHash,
            goal: input.plan.goal,
            status: "PLANNED",
            maxParallelism: input.plan.maxParallelism,
          },
        });

        await tx.invocation.createMany({
          data: input.plan.invocations.map((invocation, sequence) => ({
            id: invocationDbId(planId, invocation.id),
            planId,
            sequence,
            purpose: invocation.purpose,
            targetKind: invocation.target.kind,
            targetModelSlug: invocation.target.kind === "AI_MODEL" ? invocation.target.modelSlug : null,
            targetAgentId: invocation.target.kind === "AGENT" ? invocation.target.agentId : null,
            outputDeclarations: toJson(invocation.outputs),
            acceptanceCriteria: toJson(invocation.acceptanceCriteria),
            riskClass: invocation.riskClass,
            approvalPolicy: invocation.approvalPolicy,
            failurePolicy: invocation.failurePolicy,
            joinPolicy: invocation.joinPolicy,
            status: "PENDING",
          })),
        });

        if (input.plan.dependencies.length > 0) {
          await tx.invocationDependency.createMany({
            data: input.plan.dependencies.map((dependency) => ({
              id: dependencyDbId(planId, dependency.id),
              planId,
              fromInvocationId: invocationDbId(planId, dependency.fromInvocationId),
              toInvocationId: invocationDbId(planId, dependency.toInvocationId),
              conditionKind: dependency.condition.kind,
              conditionOutcome:
                dependency.condition.kind === "OUTCOME" ? dependency.condition.outcome : "",
              inputBindings: toJson(dependency.inputBindings),
            })),
          });
        }
      });
    } catch (error: unknown) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      const replay = await this.prisma.client.executionPlan.findFirst({
        where: { messageId: sourceMessage.id, userId },
        include: planInclude,
      });
      if (replay) {
        const view = this.resolveCreateReplay(replay, planHash);
        await this.ensureContextSnapshot(userId, replay.id);
        return view;
      }
      throw new ConflictException("Execution plan could not be created");
    }

    await this.ensureContextSnapshot(userId, planId);
    return this.getOne(userId, planId);
  }

  async getOne(userId: string, id: string): Promise<ExecutionPlanView> {
    this.assertPreviewEnabled();
    const plan = await this.prisma.client.executionPlan.findFirst({
      where: { id, userId },
      include: planInclude,
    });
    if (!plan) {
      throw new NotFoundException("Execution plan not found");
    }
    return toView(plan);
  }

  async getForMessage(
    userId: string,
    messageId: string,
  ): Promise<ExecutionPlanLookupView> {
    this.assertPreviewEnabled();
    const plan = await this.prisma.client.executionPlan.findFirst({
      where: { userId, messageId },
      include: planInclude,
    });
    return { plan: plan ? toView(plan) : null };
  }

  async getForConversation(
    userId: string,
    conversationId: string,
  ): Promise<ExecutionPlanConversationView> {
    this.assertPreviewEnabled();

    const activePlans = await this.prisma.client.executionPlan.findMany({
      where: {
        userId,
        conversationId,
        status: { in: ["PLANNING", "PLANNED", "RUNNING"] },
      },
      include: planInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (activePlans.length > 0) {
      return { plans: activePlans.map(toView) };
    }

    const latestTerminal = await this.prisma.client.executionPlan.findFirst({
      where: {
        userId,
        conversationId,
        status: {
          in: [
            "NEEDS_CLARIFICATION",
            "PARTIAL",
            "COMPLETED",
            "FAILED",
            "CANCELED",
          ],
        },
      },
      include: planInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return { plans: latestTerminal ? [toView(latestTerminal)] : [] };
  }

  async start(userId: string, id: string): Promise<ExecutionPlanView> {
    this.assertPreviewEnabled();
    await this.ensureContextSnapshot(userId, id);

    return this.prisma.client.$transaction(async (tx) => {
      const current = await tx.executionPlan.findFirst({
        where: { id, userId },
        include: planInclude,
      });
      if (!current) {
        throw new NotFoundException("Execution plan not found");
      }
      if (current.status === "RUNNING") {
        return toView(current);
      }
      if (current.status !== "PLANNED") {
        throw new ConflictException("Execution plan cannot be started from its current state");
      }

      const definition = definitionFromPersisted(current);
      validateManualExecutionPlan(definition);
      const initialStatuses = initialInvocationStatuses(definition);
      const now = new Date();
      const claimed = await tx.executionPlan.updateMany({
        where: { id, userId, status: "PLANNED" },
        data: { status: "RUNNING", startedAt: now, frozenAt: now },
      });

      if (claimed.count === 0) {
        const replay = await tx.executionPlan.findFirst({
          where: { id, userId },
          include: planInclude,
        });
        if (!replay) {
          throw new NotFoundException("Execution plan not found");
        }
        if (replay.status === "RUNNING") {
          return toView(replay);
        }
        throw new ConflictException("Execution plan cannot be started from its current state");
      }

      for (const [graphId, status] of initialStatuses) {
        if (status === "PENDING") continue;
        await tx.invocation.updateMany({
          where: {
            id: invocationDbId(id, graphId),
            planId: id,
            status: "PENDING",
          },
          data: { status },
        });
      }

      const started = await tx.executionPlan.findFirst({
        where: { id, userId },
        include: planInclude,
      });
      if (!started) {
        throw new InternalServerErrorException("Execution plan disappeared during start");
      }
      return toView(started);
    });
  }

  async stop(userId: string, id: string): Promise<ExecutionPlanView> {
    this.assertPreviewEnabled();
    return this.prisma.client.$transaction(async (tx) => {
      const current = await tx.executionPlan.findFirst({
        where: { id, userId },
        include: planInclude,
      });
      if (!current) {
        throw new NotFoundException("Execution plan not found");
      }
      if (current.status === "CANCELED" || isTerminalPlan(current.status)) {
        return toView(current);
      }

      await tx.executionPlan.updateMany({
        where: { id, userId, status: { in: ["PLANNING", "PLANNED", "RUNNING"] } },
        data: { status: "CANCELED", completedAt: new Date() },
      });
      await tx.invocation.updateMany({
        where: {
          planId: id,
          status: { in: [...ACTIVE_INVOCATION_STATUSES] },
        },
        data: { status: "CANCELED" },
      });

      const stopped = await tx.executionPlan.findFirst({
        where: { id, userId },
        include: planInclude,
      });
      if (!stopped) {
        throw new InternalServerErrorException("Execution plan disappeared during stop");
      }
      return toView(stopped);
    });
  }

  async approve(userId: string, id: string, body: unknown): Promise<ExecutionPlanView> {
    this.assertPreviewEnabled();
    const input = parseApprove(body);

    return this.prisma.client.$transaction(async (tx) => {
      const plan = await tx.executionPlan.findFirst({
        where: { id, userId },
        include: planInclude,
      });
      if (!plan) {
        throw new NotFoundException("Execution plan not found");
      }
      if (plan.status !== "RUNNING") {
        throw new ConflictException("Execution plan is not running");
      }

      const invocationId = invocationDbId(id, input.invocationId);
      const invocation = plan.invocations.find((candidate) => candidate.id === invocationId);
      if (!invocation) {
        throw new NotFoundException("Invocation not found");
      }
      if (invocation.approvalPolicy === "AUTO") {
        throw new ConflictException("Invocation does not require approval");
      }
      if (
        invocation.targetKind === "EVALUATOR" &&
        invocation.approvalPolicy === "HUMAN_APPROVAL"
      ) {
        throw new ConflictException(
          "Human evaluator decisions must use the evaluation resolution endpoint",
        );
      }

      if (invocation.status === "WAITING_APPROVAL") {
        await tx.invocation.updateMany({
          where: { id: invocationId, planId: id, status: "WAITING_APPROVAL" },
          data: { status: "READY" },
        });
      } else if (
        invocation.status !== "READY" &&
        invocation.status !== "RUNNING" &&
        invocation.status !== "COMPLETED"
      ) {
        throw new ConflictException("Invocation is not awaiting approval");
      }

      const approved = await tx.executionPlan.findFirst({
        where: { id, userId },
        include: planInclude,
      });
      if (!approved) {
        throw new InternalServerErrorException("Execution plan disappeared during approval");
      }
      return toView(approved);
    });
  }

  async resolveHumanEvaluation(
    userId: string,
    id: string,
    graphInvocationId: string,
    body: unknown,
  ): Promise<ExecutionPlanView> {
    this.assertPreviewEnabled();
    const input = parseHumanEvaluation(body);
    const parsedInvocationId = workflowGraphKeySchema.safeParse(
      graphInvocationId,
    );
    if (!parsedInvocationId.success) {
      throw new BadRequestException("Invalid invocation id");
    }
    const validatedInvocationId = parsedInvocationId.data;
    const artifacts = new ArtifactService(this.prisma.client);

    return this.prisma.client.$transaction(async (tx) => {
      const plan = await tx.executionPlan.findFirst({
        where: { id, userId },
        include: planInclude,
      });
      if (!plan) {
        throw new NotFoundException("Execution plan not found");
      }

      const invocationId = invocationDbId(id, validatedInvocationId);
      const invocation = plan.invocations.find(
        (candidate) => candidate.id === invocationId,
      );
      if (!invocation) {
        throw new NotFoundException("Invocation not found");
      }
      if (
        invocation.targetKind !== "EVALUATOR" ||
        invocation.approvalPolicy !== "HUMAN_APPROVAL"
      ) {
        throw new ConflictException(
          "Invocation is not a human evaluator",
        );
      }

      const latestRun = invocation.runs[0] ?? null;
      if (
        invocation.status === "COMPLETED" &&
        latestRun?.evaluation?.evaluatorKind === "HUMAN_APPROVAL"
      ) {
        const sameDecision =
          latestRun.evaluation.outcome === input.outcome &&
          (latestRun.evaluation.summary ?? undefined) === input.summary;
        if (!sameDecision) {
          throw new ConflictException(
            "Human evaluation was already resolved with a different decision",
          );
        }
        return toView(plan);
      }
      if (plan.status !== "RUNNING") {
        throw new ConflictException("Execution plan is not running");
      }
      if (invocation.status !== "WAITING_APPROVAL") {
        throw new ConflictException(
          "Human evaluator is not awaiting a decision",
        );
      }

      const criteria = acceptanceCriteriaSchema
        .array()
        .parse(invocation.acceptanceCriteria);
      if (
        criteria.length !== 1 ||
        criteria.some(
          (criterion) =>
            criterion.mode !== "HUMAN_APPROVAL" ||
            criterion.binding !== undefined,
        )
      ) {
        throw new ConflictException(
          "Persisted human evaluator contract is invalid",
        );
      }
      const outputs = outputDeclarationSchema
        .array()
        .parse(invocation.outputDeclarations);
      const output = outputs[0];
      if (
        outputs.length !== 1 ||
        !output ||
        output.artifactType !== "JSON"
      ) {
        throw new ConflictException(
          "Persisted human evaluator output contract is invalid",
        );
      }

      const resolvedInputs = await artifacts.resolveInputBindingsInTransaction(
        tx,
        {
          actorUserId: userId,
          targetInvocationId: invocationId,
        },
      );
      const inputFingerprint =
        fingerprintResolvedArtifactInputs(resolvedInputs);

      const claimed = await tx.invocation.updateMany({
        where: {
          id: invocationId,
          planId: id,
          status: "WAITING_APPROVAL",
        },
        data: { status: "RUNNING" },
      });
      if (claimed.count !== 1) {
        const replay = await tx.executionPlan.findFirst({
          where: { id, userId },
          include: planInclude,
        });
        const replayInvocation = replay?.invocations.find(
          (candidate) => candidate.id === invocationId,
        );
        const replayEvaluation = replayInvocation?.runs[0]?.evaluation;
        if (
          replay &&
          replayInvocation?.status === "COMPLETED" &&
          replayEvaluation?.evaluatorKind === "HUMAN_APPROVAL" &&
          replayEvaluation.outcome === input.outcome &&
          (replayEvaluation.summary ?? undefined) === input.summary
        ) {
          return toView(replay);
        }
        throw new ConflictException(
          "Human evaluator decision was resolved concurrently",
        );
      }

      const now = new Date();
      const criteriaResults = criteria.map((criterion) => ({
        criterionId: criterion.id,
        outcome: input.outcome,
        confidence: 1,
        summary: input.summary ?? null,
      }));
      const evaluationJson = {
        mode: "HUMAN_APPROVAL" as const,
        outcome: input.outcome,
        confidence: 1,
        criteriaResults,
        summary: input.summary ?? null,
      };
      const contentJson = toJson(evaluationJson);
      const runId = randomUUID();

      await tx.invocationRun.create({
        data: {
          id: runId,
          invocationId,
          attempt: (latestRun?.attempt ?? 0) + 1,
          status: "COMPLETED",
          idempotencyKey: `human-evaluation:${invocationId}:v1`,
          outcome: input.outcome,
          startedAt: now,
          finishedAt: now,
          evaluation: {
            create: {
              evaluatorKind: "HUMAN_APPROVAL",
              outcome: input.outcome,
              confidence: 1,
              inputFingerprint,
              criteriaResults: toJson(criteriaResults),
              summary: input.summary ?? null,
            },
          },
        },
      });

      await artifacts.createArtifactInTransaction(tx, {
        actorUserId: userId,
        creatorInvocationId: invocationId,
        outputName: output.name,
        type: "JSON",
        classification: "PRIVATE",
        content: {
          kind: "INLINE_JSON",
          value: contentJson,
        },
        metadata: {
          source: "EVALUATION",
          evaluatorKind: "HUMAN_APPROVAL",
        },
        versionMetadata: {
          invocationRunId: runId,
          inputFingerprint,
        },
      });

      const completed = await tx.invocation.updateMany({
        where: { id: invocationId, planId: id, status: "RUNNING" },
        data: { status: "COMPLETED" },
      });
      if (completed.count !== 1) {
        throw new ConflictException(
          "Human evaluator state changed while resolving the decision",
        );
      }

      const resolved = await tx.executionPlan.findFirst({
        where: { id, userId },
        include: planInclude,
      });
      if (!resolved) {
        throw new InternalServerErrorException(
          "Execution plan disappeared during human evaluation",
        );
      }
      return toView(resolved);
    });
  }

  private async ensureContextSnapshot(userId: string, planId: string): Promise<ContextSnapshotView> {
    try {
      const context = new ContextSnapshotService(this.prisma.client);
      return await context.createForExecutionPlan({ actorUserId: userId, planId });
    } catch (error: unknown) {
      if (error instanceof ContextNotFoundError) {
        throw new NotFoundException("Execution plan not found");
      }
      if (error instanceof ContextConflictError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  private resolveCreateReplay(existing: PersistedPlan, requestedHash: string): ExecutionPlanView {
    if (existing.planHash !== requestedHash) {
      throw new ConflictException("A different execution plan already exists for this message");
    }
    return toView(existing);
  }

  private planningLeaseMs(): number {
    return Math.max(
      MIN_PLANNING_LEASE_MS,
      this.config.semanticPlannerTimeoutMs + PLANNING_LEASE_GRACE_MS,
    );
  }

  private startPlanningHeartbeat(
    userId: string,
    planId: string,
    claimHash: string,
    abortController: AbortController,
  ): () => void {
    const intervalMs = Math.max(
      1_000,
      Math.min(
        MAX_PLANNING_HEARTBEAT_MS,
        Math.floor(this.planningLeaseMs() / 3),
      ),
    );
    let stopped = false;
    let inFlight = false;

    const heartbeat = async (): Promise<void> => {
      if (stopped || inFlight || abortController.signal.aborted) return;
      inFlight = true;
      try {
        const refreshed = await this.prisma.client.executionPlan.updateMany({
          where: {
            id: planId,
            userId,
            status: "PLANNING",
            planHash: claimHash,
          },
          data: { updatedAt: new Date() },
        });
        if (refreshed.count !== 1) {
          abortController.abort();
        }
      } catch {
        abortController.abort();
      } finally {
        inFlight = false;
      }
    };

    const timer = setInterval(() => {
      void heartbeat();
    }, intervalMs);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  private assertPreviewEnabled(): void {
    const nonProductionPreview = this.config.appEnv === "local" || this.config.appEnv === "test";
    if (!nonProductionPreview || !this.config.operatorEnabled) {
      throw new NotFoundException("Execution plans are not available");
    }
  }
}

const planInclude = {
  invocations: {
    orderBy: { sequence: "asc" as const },
    include: {
      runs: {
        orderBy: { attempt: "desc" as const },
        take: 1,
        include: { evaluation: true },
      },
      artifacts: {
        orderBy: { createdAt: "asc" as const },
        include: {
          versions: {
            orderBy: { version: "desc" as const },
            take: 1,
          },
        },
      },
    },
  },
  dependencies: { orderBy: { createdAt: "asc" as const } },
} as const;

type PersistedPlan = Prisma.ExecutionPlanGetPayload<{
  include: typeof planInclude;
}>;

function parseCreate(body: unknown): CreateExecutionPlanRequest {
  const parsed = createExecutionPlanRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new BadRequestException({ code: "validation_error", message: "Invalid execution plan payload" });
  }
  return parsed.data;
}

function parseApprove(body: unknown): ApproveExecutionPlanRequest {
  const parsed = approveExecutionPlanRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new BadRequestException({ code: "validation_error", message: "Invalid approval payload" });
  }
  return parsed.data;
}

function parseHumanEvaluation(
  body: unknown,
): ResolveHumanEvaluationRequest {
  const parsed = resolveHumanEvaluationRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new BadRequestException({
      code: "validation_error",
      message: "Invalid human evaluation payload",
    });
  }
  return parsed.data;
}

function existingSemanticPlanResult(
  plan: PersistedPlan,
): SemanticPlanMessageResult {
  if (isClarificationShell(plan)) {
    return {
      kind: "CLARIFICATION_REQUIRED",
      clarificationQuestion: plan.goal,
    };
  }
  const view = toView(plan);
  return plan.status === "PLANNED"
    ? { kind: "PLANNED", plan: view }
    : { kind: "EXISTING_PLAN", plan: view };
}

function planningClaimHash(planId: string, correlationId: string): string {
  return (
    PLANNING_CLAIM_PREFIX +
    createHash("sha256")
      .update(`${planId}:${correlationId}`)
      .digest("hex")
  );
}

function isClarificationShell(plan: PersistedPlan): boolean {
  return (
    plan.status === "NEEDS_CLARIFICATION" &&
    plan.planHash.startsWith(CLARIFICATION_HASH_PREFIX)
  );
}

function hashPlan(plan: ExecutionPlanDefinition): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(plan)).digest("hex")}`;
}

function invocationDbId(planId: string, graphId: string): string {
  return `${planId}:inv:${Buffer.from(graphId, "utf8").toString("base64url")}`;
}

function dependencyDbId(planId: string, graphId: string): string {
  return `${planId}:dep:${Buffer.from(graphId, "utf8").toString("base64url")}`;
}

function decodeGraphId(planId: string, kind: "inv" | "dep", dbId: string): string {
  const prefix = `${planId}:${kind}:`;
  if (!dbId.startsWith(prefix)) {
    return dbId;
  }
  const encoded = dbId.slice(prefix.length);
  try {
    return Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return dbId;
  }
}

function definitionFromPersisted(plan: PersistedPlan): ExecutionPlanDefinition {
  const invocationKeyByDbId = new Map<string, string>();
  const invocations = plan.invocations.map((invocation) => {
    const graphId = decodeGraphId(plan.id, "inv", invocation.id);
    invocationKeyByDbId.set(invocation.id, graphId);
    return invocationSchema.parse({
      id: graphId,
      purpose: invocation.purpose,
      target: persistedTarget(invocation.targetKind, invocation.targetModelSlug, invocation.targetAgentId),
      outputs: invocation.outputDeclarations,
      acceptanceCriteria: invocation.acceptanceCriteria,
      riskClass: invocation.riskClass,
      approvalPolicy: invocation.approvalPolicy,
      failurePolicy: invocation.failurePolicy,
      joinPolicy: invocation.joinPolicy,
    });
  });

  const dependencies = plan.dependencies.map((dependency) =>
    invocationDependencySchema.parse({
      id: decodeGraphId(plan.id, "dep", dependency.id),
      fromInvocationId: requiredGraphKey(invocationKeyByDbId, dependency.fromInvocationId),
      toInvocationId: requiredGraphKey(invocationKeyByDbId, dependency.toInvocationId),
      condition: persistedCondition(dependency.conditionKind, dependency.conditionOutcome),
      inputBindings: dependency.inputBindings,
    }),
  );

  if (plan.schemaVersion !== 1) {
    throw new InternalServerErrorException("Unsupported persisted execution plan schema");
  }
  return {
    schemaVersion: 1,
    goal: plan.goal,
    maxParallelism: plan.maxParallelism,
    invocations,
    dependencies,
  };
}

function toView(plan: PersistedPlan): ExecutionPlanView {
  if (
    plan.status === "PLANNING" ||
    plan.status === "NEEDS_CLARIFICATION"
  ) {
    if (plan.schemaVersion !== 1) {
      throw new InternalServerErrorException(
        "Unsupported persisted execution plan schema",
      );
    }
    return {
      id: plan.id,
      messageId: plan.messageId,
      conversationId: plan.conversationId,
      schemaVersion: 1,
      version: plan.version,
      planHash: plan.planHash,
      goal: plan.goal,
      status:
        plan.status === "NEEDS_CLARIFICATION"
          ? "NEEDS_CLARIFICATION"
          : "PLANNING",
      maxParallelism: plan.maxParallelism,
      invocations: [],
      dependencies: [],
      startedAt: plan.startedAt?.toISOString() ?? null,
      frozenAt: plan.frozenAt?.toISOString() ?? null,
      completedAt: plan.completedAt?.toISOString() ?? null,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    };
  }

  const definition = definitionFromPersisted(plan);
  const persistedByGraphId = new Map(
    plan.invocations.map((invocation) => [
      decodeGraphId(plan.id, "inv", invocation.id),
      invocation,
    ]),
  );

  return {
    id: plan.id,
    messageId: plan.messageId,
    conversationId: plan.conversationId,
    schemaVersion: definition.schemaVersion,
    version: plan.version,
    planHash: plan.planHash,
    goal: definition.goal,
    status: parsePlanStatus(plan.status),
    maxParallelism: definition.maxParallelism,
    invocations: definition.invocations.map((invocation) => {
      const persisted = persistedByGraphId.get(invocation.id);
      if (!persisted) {
        throw new InternalServerErrorException(
          "Execution plan invocation disappeared while building the UI view",
        );
      }
      const status = parseInvocationStatus(persisted.status);
      const latestRun = persisted.runs[0] ?? null;

      return {
        ...invocation,
        status,
        requiresApproval: status === "WAITING_APPROVAL",
        latestRun: latestRun
          ? {
              id: latestRun.id,
              attempt: latestRun.attempt,
              status: parseInvocationRunStatus(latestRun.status),
              outcome: latestRun.outcome,
              errorCode: latestRun.errorCode,
              startedAt: latestRun.startedAt?.toISOString() ?? null,
              finishedAt: latestRun.finishedAt?.toISOString() ?? null,
              evaluation: latestRun.evaluation
                ? workflowEvaluationSchema.parse({
                    mode: latestRun.evaluation.evaluatorKind,
                    outcome: latestRun.evaluation.outcome,
                    confidence: latestRun.evaluation.confidence,
                    criteriaResults: latestRun.evaluation.criteriaResults,
                    summary: latestRun.evaluation.summary,
                  })
                : null,
            }
          : null,
        artifacts: persisted.artifacts.flatMap((artifact) => {
          const version = artifact.versions[0];
          if (!version) return [];
          return [
            {
              artifactId: artifact.id,
              artifactVersionId: version.id,
              outputName: artifact.outputName,
              type: artifactTypeSchema.parse(artifact.type),
              classification: artifact.classification,
              version: version.version,
              createdAt: version.createdAt.toISOString(),
            },
          ];
        }),
      };
    }),
    dependencies: definition.dependencies,
    startedAt: plan.startedAt?.toISOString() ?? null,
    frozenAt: plan.frozenAt?.toISOString() ?? null,
    completedAt: plan.completedAt?.toISOString() ?? null,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

function persistedTarget(kind: string, modelSlug: string | null, agentId: string | null): unknown {
  switch (kind) {
    case "VIMLA":
    case "AI_AUTO":
    case "EVALUATOR":
      return { kind };
    case "AI_MODEL":
      return { kind, modelSlug };
    case "AGENT":
      return { kind, agentId };
    default:
      throw new InternalServerErrorException("Invalid persisted invocation target");
  }
}

function persistedCondition(kind: string, outcome: string): DependencyConditionDefinition {
  switch (kind) {
    case "DATA":
    case "ON_SUCCESS":
    case "ON_FAILURE":
    case "ALWAYS":
      return { kind };
    case "OUTCOME":
      return { kind, outcome };
    default:
      throw new InternalServerErrorException("Invalid persisted dependency condition");
  }
}

function requiredGraphKey(keys: ReadonlyMap<string, string>, dbId: string): string {
  const value = keys.get(dbId);
  if (!value) {
    throw new InternalServerErrorException("Execution plan dependency references an invalid invocation");
  }
  return value;
}

function parseInvocationRunStatus(
  status: string,
): WorkflowInvocationRunStatus {
  const parsed = workflowInvocationRunStatusSchema.safeParse(status);
  if (!parsed.success) {
    throw new InternalServerErrorException(
      "Invalid persisted invocation run status",
    );
  }
  return parsed.data;
}

function parseInvocationStatus(status: string): InvocationStatus {
  switch (status) {
    case "PENDING":
    case "READY":
    case "RUNNING":
    case "WAITING_APPROVAL":
    case "WAITING_FOR_USAGE_CAPACITY":
    case "BLOCKED_INSUFFICIENT_USAGE":
    case "COMPLETED":
    case "FAILED":
    case "SKIPPED":
    case "CANCELED":
      return status;
    default:
      throw new InternalServerErrorException("Invalid persisted invocation status");
  }
}

function parsePlanStatus(status: string): ExecutionPlanStatus {
  switch (status) {
    case "PLANNING":
    case "NEEDS_CLARIFICATION":
    case "PLANNED":
    case "RUNNING":
    case "PARTIAL":
    case "COMPLETED":
    case "FAILED":
    case "CANCELED":
      return status;
    default:
      throw new InternalServerErrorException("Invalid persisted execution plan status");
  }
}

function isTerminalPlan(status: string): boolean {
  return (
    status === "NEEDS_CLARIFICATION" ||
    status === "PARTIAL" ||
    status === "COMPLETED" ||
    status === "FAILED" ||
    status === "CANCELED"
  );
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
