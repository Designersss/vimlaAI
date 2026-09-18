import { Prisma, type PrismaClient } from "@vimla/database";
import { isDuplicateJobError } from "./queue.js";
import {
  INVOCATION_EXECUTE_JOB_NAME,
  invocationExecuteJobId,
  ORCHESTRATION_DISPATCH_JOB_NAME,
  orchestrationDispatchJobId,
} from "./queue.js";

const ACTIVE_INVOCATION_STATUSES = [
  "PENDING",
  "READY",
  "RUNNING",
  "WAITING_APPROVAL",
  "WAITING_FOR_USAGE_CAPACITY",
  "BLOCKED_INSUFFICIENT_USAGE",
] as const;
const TERMINAL_INVOCATION_STATUSES = new Set<InvocationStatus>([
  "COMPLETED",
  "FAILED",
  "SKIPPED",
  "CANCELED",
]);

export type InvocationStatus =
  | "PENDING"
  | "READY"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "WAITING_FOR_USAGE_CAPACITY"
  | "BLOCKED_INSUFFICIENT_USAGE"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED"
  | "CANCELED";

type TargetKind = "VIMLA" | "AI_AUTO" | "AI_MODEL" | "AGENT" | "EVALUATOR";
type ApprovalPolicy = "AUTO" | "USER_CONFIRMATION" | "HUMAN_APPROVAL";
type FailurePolicy = "FAIL_PLAN" | "CONTINUE";
type JoinPolicy = "ALL_REQUIRED" | "ANY_REQUIRED" | "ALL_SETTLED";
type DependencyConditionKind = "DATA" | "ON_SUCCESS" | "ON_FAILURE" | "ALWAYS" | "OUTCOME";

type RuntimeInvocation = {
  id: string;
  sequence: number;
  targetKind: TargetKind;
  targetModelSlug: string | null;
  targetAgentId: string | null;
  approvalPolicy: ApprovalPolicy;
  failurePolicy: FailurePolicy;
  joinPolicy: JoinPolicy;
  status: InvocationStatus;
  latestOutcome: string | null;
};

type RuntimeDependency = {
  fromInvocationId: string;
  toInvocationId: string;
  conditionKind: DependencyConditionKind;
  conditionOutcome: string;
};

type DependencyEvaluation = "WAITING" | "SATISFIED" | "IMPOSSIBLE";
type ReadinessDecision = "PENDING" | "READY" | "SKIPPED";

export interface QueuePublisher {
  add(
    name: string,
    data: Record<string, string>,
    options: { jobId: string; removeOnComplete: true; removeOnFail: true },
  ): Promise<unknown>;
}

export interface RuntimeLogger {
  info(fields: Record<string, string | number | boolean | null>, message: string): void;
  warn(fields: Record<string, string | number | boolean | null>, message: string): void;
  error(fields: Record<string, string | number | boolean | null>, message: string): void;
}

export interface InvocationExecutionInput {
  planId: string;
  invocationId: string;
  attempt: number;
  runId: string;
  idempotencyKey: string;
  target: {
    kind: TargetKind;
    modelSlug: string | null;
    agentId: string | null;
  };
}

export type InvocationExecutionResult =
  | { status: "COMPLETED"; outcome?: string }
  | { status: "WAITING_FOR_USAGE_CAPACITY"; errorCode: "BILLING_INSUFFICIENT_USAGE" }
  | { status: "BLOCKED_INSUFFICIENT_USAGE"; errorCode: "BILLING_INSUFFICIENT_USAGE" }
  | { status: "FAILED"; errorCode: string; retryable: boolean };

export interface InvocationExecutorRegistry {
  execute(input: InvocationExecutionInput): Promise<InvocationExecutionResult>;
}

export class MockInvocationExecutorRegistry implements InvocationExecutorRegistry {
  async execute(input: InvocationExecutionInput): Promise<InvocationExecutionResult> {
    return input.target.kind === "EVALUATOR"
      ? { status: "COMPLETED", outcome: "PASS" }
      : { status: "COMPLETED" };
  }
}

export interface OrchestrationRuntimeOptions {
  maxAttempts?: number;
  staleAfterMs?: number;
  reconcileBatchSize?: number;
  usageRecheckBaseMs?: number;
  usageRecheckMaxMs?: number;
  executorRegistry?: InvocationExecutorRegistry;
}

type ClaimedInvocation = {
  planId: string;
  invocationId: string;
  attempt: number;
  runId: string;
  idempotencyKey: string;
  failurePolicy: FailurePolicy;
  target: InvocationExecutionInput["target"];
};

type RuntimePlan = Prisma.ExecutionPlanGetPayload<{
  include: {
    invocations: { include: { runs: true } };
    dependencies: true;
  };
}>;

export class OrchestrationRuntime {
  private readonly maxAttempts: number;
  private readonly staleAfterMs: number;
  private readonly reconcileBatchSize: number;
  private readonly usageRecheckBaseMs: number;
  private readonly usageRecheckMaxMs: number;
  private readonly executorRegistry: InvocationExecutorRegistry;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly dispatchQueue: QueuePublisher,
    private readonly executionQueue: QueuePublisher,
    private readonly logger: RuntimeLogger,
    options: OrchestrationRuntimeOptions = {},
  ) {
    this.maxAttempts = positiveInteger(options.maxAttempts, 3);
    this.staleAfterMs = positiveInteger(options.staleAfterMs, 60_000);
    this.reconcileBatchSize = positiveInteger(options.reconcileBatchSize, 100);
    this.usageRecheckBaseMs = positiveInteger(options.usageRecheckBaseMs, 15_000);
    this.usageRecheckMaxMs = positiveInteger(options.usageRecheckMaxMs, 60_000);
    if (this.usageRecheckMaxMs < this.usageRecheckBaseMs) {
      throw new Error("usageRecheckMaxMs must be >= usageRecheckBaseMs");
    }
    this.executorRegistry = options.executorRegistry ?? new MockInvocationExecutorRegistry();
  }

  async reconcile(): Promise<void> {
    await this.recoverStaleRuns();

    let cursor: string | undefined;
    for (;;) {
      const plans = await this.prisma.executionPlan.findMany({
        where: { status: "RUNNING" },
        select: { id: true },
        orderBy: { id: "asc" },
        take: this.reconcileBatchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const plan of plans) {
        await this.enqueueDispatch(plan.id);
      }
      if (plans.length < this.reconcileBatchSize) break;
      cursor = plans.at(-1)?.id;
      if (!cursor) break;
    }
  }

  async dispatchPlan(planId: string): Promise<void> {
    const readyInvocationIds = await this.prisma.$transaction(async (tx) => {
      if (!(await lockPlan(tx, planId))) return [];
      const plan = await loadRuntimePlan(tx, planId);
      if (!plan || plan.status !== "RUNNING") return [];

      const invocations = toRuntimeInvocations(plan);
      const dependencies = toRuntimeDependencies(plan);
      const stateById = new Map(invocations.map((invocation) => [invocation.id, invocation.status]));
      const outcomeById = new Map(invocations.map((invocation) => [invocation.id, invocation.latestOutcome]));

      for (const invocation of plan.invocations) {
        const status = parseInvocationStatus(invocation.status);
        if (
          status !== "WAITING_FOR_USAGE_CAPACITY" &&
          status !== "BLOCKED_INSUFFICIENT_USAGE"
        ) {
          continue;
        }
        const latestRun = invocation.runs[0];
        if (!latestRun?.finishedAt) continue;
        const retryAfterMs = usageBackoffMs(
          latestRun.attempt,
          this.usageRecheckBaseMs,
          this.usageRecheckMaxMs,
        );
        if (Date.now() - latestRun.finishedAt.getTime() < retryAfterMs) continue;
        const resumed = await tx.invocation.updateMany({
          where: { id: invocation.id, planId, status },
          data: { status: "READY" },
        });
        if (resumed.count === 1) {
          stateById.set(invocation.id, "READY");
          this.logger.info(
            { planId, invocationId: invocation.id, previousStatus: status },
            "orchestration usage-capacity invocation rechecked",
          );
        }
      }

      for (let pass = 0; pass <= invocations.length; pass += 1) {
        let changed = false;
        for (const invocation of invocations) {
          if (stateById.get(invocation.id) !== "PENDING") continue;
          const decision = decideReadiness(invocation, dependencies, stateById, outcomeById);
          if (decision === "PENDING") continue;

          const nextStatus: InvocationStatus =
            decision === "SKIPPED"
              ? "SKIPPED"
              : invocation.approvalPolicy === "AUTO"
                ? "READY"
                : "WAITING_APPROVAL";
          const updated = await tx.invocation.updateMany({
            where: { id: invocation.id, planId, status: "PENDING" },
            data: { status: nextStatus },
          });
          if (updated.count === 1) {
            stateById.set(invocation.id, nextStatus);
            changed = true;
          }
        }
        if (!changed) break;
      }

      const failPlanInvocation = invocations.find(
        (invocation) => stateById.get(invocation.id) === "FAILED" && invocation.failurePolicy === "FAIL_PLAN",
      );
      if (failPlanInvocation) {
        await failPlan(tx, planId, failPlanInvocation.id, new Date());
        return [];
      }

      const statuses = [...stateById.values()];
      if (statuses.every(isTerminalInvocationStatus)) {
        const terminalStatus = statuses.some((status) => status === "FAILED" || status === "CANCELED")
          ? "PARTIAL"
          : "COMPLETED";
        await tx.executionPlan.updateMany({
          where: { id: planId, status: "RUNNING" },
          data: { status: terminalStatus, completedAt: new Date() },
        });
        return [];
      }

      const running = statuses.filter((status) => status === "RUNNING").length;
      const slots = Math.max(0, plan.maxParallelism - running);
      if (slots === 0) return [];

      return invocations
        .filter((invocation) => stateById.get(invocation.id) === "READY")
        .sort((left, right) => left.sequence - right.sequence)
        .slice(0, slots)
        .map((invocation) => invocation.id);
    });

    for (const invocationId of readyInvocationIds) {
      await this.enqueueInvocation(planId, invocationId);
    }
  }

  async processInvocation(planId: string, invocationId: string): Promise<void> {
    const claim = await this.claimInvocation(planId, invocationId);
    if (!claim) {
      await this.enqueueDispatch(planId);
      return;
    }

    let result: InvocationExecutionResult;
    try {
      result = await this.executorRegistry.execute({
        planId: claim.planId,
        invocationId: claim.invocationId,
        attempt: claim.attempt,
        runId: claim.runId,
        idempotencyKey: claim.idempotencyKey,
        target: claim.target,
      });
    } catch (error: unknown) {
      this.logger.error(
        {
          planId,
          invocationId,
          attempt: claim.attempt,
          error: error instanceof Error ? error.name : "unknown",
        },
        "orchestration mock executor failed unexpectedly",
      );
      result = { status: "FAILED", errorCode: "EXECUTOR_ERROR", retryable: true };
    }

    await this.persistExecutionResult(claim, result);
    await this.enqueueDispatch(planId);
  }

  private async claimInvocation(planId: string, invocationId: string): Promise<ClaimedInvocation | null> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockPlan(tx, planId))) return null;
      const plan = await loadRuntimePlan(tx, planId);
      if (!plan || plan.status !== "RUNNING") return null;

      const invocation = plan.invocations.find((candidate) => candidate.id === invocationId);
      if (!invocation || parseInvocationStatus(invocation.status) !== "READY") return null;

      const runningCount = plan.invocations.filter(
        (candidate) => parseInvocationStatus(candidate.status) === "RUNNING",
      ).length;
      if (runningCount >= plan.maxParallelism) return null;

      const attempt = (invocation.runs[0]?.attempt ?? 0) + 1;
      const idempotencyKey = invocationRunIdempotencyKey(invocationId, attempt);
      const claimed = await tx.invocation.updateMany({
        where: { id: invocationId, planId, status: "READY" },
        data: { status: "RUNNING" },
      });
      if (claimed.count !== 1) return null;

      const run = await tx.invocationRun.create({
        data: {
          invocationId,
          attempt,
          idempotencyKey,
          status: "RUNNING",
          startedAt: new Date(),
        },
        select: { id: true },
      });

      return {
        planId,
        invocationId,
        attempt,
        runId: run.id,
        idempotencyKey,
        failurePolicy: parseFailurePolicy(invocation.failurePolicy),
        target: {
          kind: parseTargetKind(invocation.targetKind),
          modelSlug: invocation.targetModelSlug,
          agentId: invocation.targetAgentId,
        },
      };
    });
  }

  private async persistExecutionResult(
    claim: ClaimedInvocation,
    result: InvocationExecutionResult,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (!(await lockPlan(tx, claim.planId))) return;
      const plan = await tx.executionPlan.findUnique({ where: { id: claim.planId }, select: { status: true } });
      const run = await tx.invocationRun.findUnique({
        where: { id: claim.runId },
        include: { invocation: { select: { status: true, failurePolicy: true } } },
      });
      if (!plan || !run || run.status !== "RUNNING") return;

      if (plan.status !== "RUNNING" || run.invocation.status !== "RUNNING") {
        await tx.invocationRun.updateMany({
          where: { id: claim.runId, status: "RUNNING" },
          data: { status: "CANCELED", errorCode: "INVOCATION_NO_LONGER_ACTIVE", finishedAt: new Date() },
        });
        return;
      }

      const now = new Date();
      if (
        result.status === "WAITING_FOR_USAGE_CAPACITY" ||
        result.status === "BLOCKED_INSUFFICIENT_USAGE"
      ) {
        await tx.invocationRun.update({
          where: { id: claim.runId },
          data: {
            status: result.status,
            errorCode: result.errorCode,
            finishedAt: now,
          },
        });
        await tx.invocation.updateMany({
          where: { id: claim.invocationId, planId: claim.planId, status: "RUNNING" },
          data: { status: result.status },
        });
        return;
      }

      if (result.status === "COMPLETED") {
        await tx.invocationRun.update({
          where: { id: claim.runId },
          data: { status: "COMPLETED", outcome: result.outcome ?? null, finishedAt: now },
        });
        await tx.invocation.updateMany({
          where: { id: claim.invocationId, planId: claim.planId, status: "RUNNING" },
          data: { status: "COMPLETED" },
        });
        return;
      }

      await tx.invocationRun.update({
        where: { id: claim.runId },
        data: { status: "FAILED", errorCode: result.errorCode, finishedAt: now },
      });

      if (result.retryable && claim.attempt < this.maxAttempts) {
        await tx.invocation.updateMany({
          where: { id: claim.invocationId, planId: claim.planId, status: "RUNNING" },
          data: { status: "READY" },
        });
        return;
      }

      await tx.invocation.updateMany({
        where: { id: claim.invocationId, planId: claim.planId, status: "RUNNING" },
        data: { status: "FAILED" },
      });
      if (parseFailurePolicy(run.invocation.failurePolicy) === "FAIL_PLAN") {
        await failPlan(tx, claim.planId, claim.invocationId, now);
      }
    });
  }

  private async recoverStaleRuns(): Promise<void> {
    const cutoff = new Date(Date.now() - this.staleAfterMs);
    const staleRuns = await this.prisma.invocationRun.findMany({
      where: { status: "RUNNING", startedAt: { lt: cutoff } },
      select: { id: true, invocationId: true },
      orderBy: { id: "asc" },
      take: this.reconcileBatchSize,
    });

    for (const stale of staleRuns) {
      await this.recoverStaleRun(stale.id, stale.invocationId);
    }
  }

  private async recoverStaleRun(runId: string, invocationId: string): Promise<void> {
    let planId: string | null = null;
    await this.prisma.$transaction(async (tx) => {
      const initial = await tx.invocation.findUnique({
        where: { id: invocationId },
        select: { planId: true },
      });
      if (!initial || !(await lockPlan(tx, initial.planId))) return;
      planId = initial.planId;

      const run = await tx.invocationRun.findUnique({
        where: { id: runId },
        include: {
          invocation: { include: { plan: { select: { status: true } } } },
        },
      });
      if (!run || run.status !== "RUNNING") return;
      if (!run.startedAt || Date.now() - run.startedAt.getTime() < this.staleAfterMs) return;

      const now = new Date();
      if (run.invocation.plan.status !== "RUNNING" || run.invocation.status !== "RUNNING") {
        await tx.invocationRun.update({
          where: { id: runId },
          data: { status: "CANCELED", errorCode: "INVOCATION_NO_LONGER_ACTIVE", finishedAt: now },
        });
        return;
      }

      await tx.invocationRun.update({
        where: { id: runId },
        data: { status: "FAILED", errorCode: "WORKER_INTERRUPTED", finishedAt: now },
      });
      if (run.attempt < this.maxAttempts) {
        await tx.invocation.updateMany({
          where: { id: invocationId, status: "RUNNING" },
          data: { status: "READY" },
        });
        return;
      }

      await tx.invocation.updateMany({
        where: { id: invocationId, status: "RUNNING" },
        data: { status: "FAILED" },
      });
      if (parseFailurePolicy(run.invocation.failurePolicy) === "FAIL_PLAN") {
        await failPlan(tx, run.invocation.planId, invocationId, now);
      }
    });

    if (planId) {
      this.logger.warn({ planId, invocationId, runId }, "recovered stale orchestration invocation run");
    }
  }

  private async enqueueDispatch(planId: string): Promise<void> {
    try {
      await this.dispatchQueue.add(
        ORCHESTRATION_DISPATCH_JOB_NAME,
        { planId },
        {
          jobId: orchestrationDispatchJobId(planId),
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error: unknown) {
      if (isDuplicateJobError(error)) return;
      throw error;
    }
  }

  private async enqueueInvocation(planId: string, invocationId: string): Promise<void> {
    try {
      await this.executionQueue.add(
        INVOCATION_EXECUTE_JOB_NAME,
        { planId, invocationId },
        {
          jobId: invocationExecuteJobId(invocationId),
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error: unknown) {
      if (isDuplicateJobError(error)) return;
      throw error;
    }
  }
}

export function parseOrchestrationDispatchPayload(data: unknown): { planId: string } {
  const value = strictRecord(data, ["planId"]);
  return { planId: nonEmptyString(value.planId, "planId") };
}

export function parseInvocationExecutePayload(data: unknown): { planId: string; invocationId: string } {
  const value = strictRecord(data, ["planId", "invocationId"]);
  return {
    planId: nonEmptyString(value.planId, "planId"),
    invocationId: nonEmptyString(value.invocationId, "invocationId"),
  };
}

async function lockPlan(tx: Prisma.TransactionClient, planId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "execution_plan" WHERE "id" = ${planId} FOR UPDATE`,
  );
  return rows.length === 1;
}

async function loadRuntimePlan(tx: Prisma.TransactionClient, planId: string): Promise<RuntimePlan | null> {
  return tx.executionPlan.findUnique({
    where: { id: planId },
    include: {
      invocations: {
        orderBy: { sequence: "asc" },
        include: { runs: { orderBy: { attempt: "desc" } } },
      },
      dependencies: { orderBy: { createdAt: "asc" } },
    },
  });
}

function toRuntimeInvocations(plan: RuntimePlan): RuntimeInvocation[] {
  return plan.invocations.map((invocation) => ({
    id: invocation.id,
    sequence: invocation.sequence,
    targetKind: parseTargetKind(invocation.targetKind),
    targetModelSlug: invocation.targetModelSlug,
    targetAgentId: invocation.targetAgentId,
    approvalPolicy: parseApprovalPolicy(invocation.approvalPolicy),
    failurePolicy: parseFailurePolicy(invocation.failurePolicy),
    joinPolicy: parseJoinPolicy(invocation.joinPolicy),
    status: parseInvocationStatus(invocation.status),
    latestOutcome: invocation.runs[0]?.outcome ?? null,
  }));
}

function toRuntimeDependencies(plan: RuntimePlan): RuntimeDependency[] {
  return plan.dependencies.map((dependency) => ({
    fromInvocationId: dependency.fromInvocationId,
    toInvocationId: dependency.toInvocationId,
    conditionKind: parseConditionKind(dependency.conditionKind),
    conditionOutcome: dependency.conditionOutcome,
  }));
}

function decideReadiness(
  invocation: RuntimeInvocation,
  dependencies: readonly RuntimeDependency[],
  stateById: ReadonlyMap<string, InvocationStatus>,
  outcomeById: ReadonlyMap<string, string | null>,
): ReadinessDecision {
  const incoming = dependencies.filter((dependency) => dependency.toInvocationId === invocation.id);
  if (incoming.length === 0) return "READY";

  const evaluations = incoming.map((dependency) => {
    const sourceStatus = stateById.get(dependency.fromInvocationId);
    if (!sourceStatus) return "WAITING" as const;
    return evaluateCondition(dependency, sourceStatus, outcomeById.get(dependency.fromInvocationId) ?? null);
  });

  if (invocation.joinPolicy === "ALL_SETTLED") {
    return evaluations.every((value) => value !== "WAITING") ? "READY" : "PENDING";
  }
  if (invocation.joinPolicy === "ANY_REQUIRED") {
    if (evaluations.some((value) => value === "SATISFIED")) return "READY";
    if (evaluations.every((value) => value === "IMPOSSIBLE")) return "SKIPPED";
    return "PENDING";
  }
  if (evaluations.some((value) => value === "IMPOSSIBLE")) return "SKIPPED";
  if (evaluations.every((value) => value === "SATISFIED")) return "READY";
  return "PENDING";
}

function evaluateCondition(
  dependency: RuntimeDependency,
  sourceStatus: InvocationStatus,
  outcome: string | null,
): DependencyEvaluation {
  if (!isTerminalInvocationStatus(sourceStatus)) return "WAITING";

  switch (dependency.conditionKind) {
    case "ALWAYS":
      return "SATISFIED";
    case "DATA":
    case "ON_SUCCESS":
      return sourceStatus === "COMPLETED" ? "SATISFIED" : "IMPOSSIBLE";
    case "ON_FAILURE":
      return sourceStatus === "FAILED" ? "SATISFIED" : "IMPOSSIBLE";
    case "OUTCOME":
      return sourceStatus === "COMPLETED" && outcome === dependency.conditionOutcome
        ? "SATISFIED"
        : "IMPOSSIBLE";
  }
}

async function failPlan(
  tx: Prisma.TransactionClient,
  planId: string,
  failedInvocationId: string,
  now: Date,
): Promise<void> {
  await tx.executionPlan.updateMany({
    where: { id: planId, status: "RUNNING" },
    data: { status: "FAILED", completedAt: now },
  });
  await tx.invocation.updateMany({
    where: {
      planId,
      id: { not: failedInvocationId },
      status: { in: [...ACTIVE_INVOCATION_STATUSES] },
    },
    data: { status: "CANCELED" },
  });
}

function invocationRunIdempotencyKey(invocationId: string, attempt: number): string {
  return `orchestration:${Buffer.from(invocationId, "utf8").toString("base64url")}:attempt:${attempt}`;
}

function isTerminalInvocationStatus(status: InvocationStatus): boolean {
  return TERMINAL_INVOCATION_STATUSES.has(status);
}

function parseInvocationStatus(value: string): InvocationStatus {
  switch (value) {
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
      return value;
    default:
      throw new Error(`Unsupported invocation status ${value}`);
  }
}

function parseTargetKind(value: string): TargetKind {
  switch (value) {
    case "VIMLA":
    case "AI_AUTO":
    case "AI_MODEL":
    case "AGENT":
    case "EVALUATOR":
      return value;
    default:
      throw new Error(`Unsupported invocation target ${value}`);
  }
}

function parseApprovalPolicy(value: string): ApprovalPolicy {
  switch (value) {
    case "AUTO":
    case "USER_CONFIRMATION":
    case "HUMAN_APPROVAL":
      return value;
    default:
      throw new Error(`Unsupported approval policy ${value}`);
  }
}

function parseFailurePolicy(value: string): FailurePolicy {
  if (value === "FAIL_PLAN" || value === "CONTINUE") return value;
  throw new Error(`Unsupported failure policy ${value}`);
}

function parseJoinPolicy(value: string): JoinPolicy {
  if (value === "ALL_REQUIRED" || value === "ANY_REQUIRED" || value === "ALL_SETTLED") return value;
  throw new Error(`Unsupported join policy ${value}`);
}

function parseConditionKind(value: string): DependencyConditionKind {
  switch (value) {
    case "DATA":
    case "ON_SUCCESS":
    case "ON_FAILURE":
    case "ALWAYS":
    case "OUTCOME":
      return value;
    default:
      throw new Error(`Unsupported dependency condition ${value}`);
  }
}

function strictRecord(input: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Invalid orchestration queue payload");
  }
  const value = input as Record<string, unknown>;
  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) {
    throw new Error("Invalid orchestration queue payload");
  }
  return value;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid orchestration queue payload field ${field}`);
  }
  return value;
}

function usageBackoffMs(attempt: number, baseMs: number, maxMs: number): number {
  const exponent = Math.max(0, Math.min(attempt - 1, 8));
  return Math.min(maxMs, baseMs * 2 ** exponent);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}
