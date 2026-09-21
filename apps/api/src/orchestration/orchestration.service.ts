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
  ContextConflictError,
  ContextNotFoundError,
  ContextSnapshotService,
} from "@vimla/context";
import { type Prisma } from "@vimla/database";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { PrismaService } from "../persistence/prisma.service.js";
import {
  approveExecutionPlanRequestSchema,
  artifactTypeSchema,
  createExecutionPlanRequestSchema,
  invocationDependencySchema,
  invocationSchema,
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
  type WorkflowInvocationRunStatus,
} from "./contracts.js";
import { initialInvocationStatuses, validateManualExecutionPlan } from "./plan-validation.js";

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
  ) {}

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
        status: { in: ["PARTIAL", "COMPLETED", "FAILED", "CANCELED"] },
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
        where: { id, userId, status: { in: ["PLANNED", "RUNNING"] } },
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

  private async ensureContextSnapshot(userId: string, planId: string): Promise<void> {
    try {
      const context = new ContextSnapshotService(this.prisma.client);
      await context.createForExecutionPlan({ actorUserId: userId, planId });
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
  return status === "PARTIAL" || status === "COMPLETED" || status === "FAILED";
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
