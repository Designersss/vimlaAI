import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@vimla/database";
import {
  OrchestrationRuntime,
  type InvocationExecutionInput,
  type InvocationExecutionResult,
  type InvocationExecutorRegistry,
  type QueuePublisher,
} from "./orchestration.js";
import {
  INVOCATION_EXECUTE_JOB_NAME,
  ORCHESTRATION_DISPATCH_JOB_NAME,
} from "./queue.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

type MemoryJob = {
  name: string;
  data: Record<string, string>;
  jobId: string;
};

class MemoryQueue implements QueuePublisher {
  readonly jobs = new Map<string, MemoryJob>();
  failAdds = false;

  async add(
    name: string,
    data: Record<string, string>,
    options: { jobId: string; removeOnComplete: true; removeOnFail: true },
  ): Promise<unknown> {
    if (this.failAdds) {
      throw new Error("redis unavailable");
    }
    if (this.jobs.has(options.jobId)) {
      throw new Error(`Job with id ${options.jobId} already exists`);
    }
    this.jobs.set(options.jobId, { name, data, jobId: options.jobId });
    return { id: options.jobId };
  }

  take(name: string): MemoryJob {
    const entry = [...this.jobs.entries()].find(([, job]) => job.name === name);
    if (!entry) {
      throw new Error(`Missing queued job ${name}`);
    }
    this.jobs.delete(entry[0]);
    return entry[1];
  }

  count(name: string): number {
    return [...this.jobs.values()].filter((job) => job.name === name).length;
  }
}

class ScriptedExecutor implements InvocationExecutorRegistry {
  readonly calls: InvocationExecutionInput[] = [];

  constructor(
    private readonly handler: (
      input: InvocationExecutionInput,
      callNumber: number,
    ) => Promise<InvocationExecutionResult> | InvocationExecutionResult,
  ) {}

  async execute(input: InvocationExecutionInput): Promise<InvocationExecutionResult> {
    this.calls.push(input);
    return this.handler(input, this.calls.length);
  }
}

class BlockingExecutor implements InvocationExecutorRegistry {
  readonly started = new Set<string>();
  private readonly releases = new Map<string, (result: InvocationExecutionResult) => void>();
  private readonly waiters: Array<{ count: number; resolve: () => void }> = [];

  execute(input: InvocationExecutionInput): Promise<InvocationExecutionResult> {
    this.started.add(input.invocationId);
    this.notifyWaiters();
    return new Promise((resolve) => {
      this.releases.set(input.invocationId, resolve);
    });
  }

  async waitForCount(count: number): Promise<void> {
    if (this.started.size >= count) return;
    await new Promise<void>((resolve) => {
      this.waiters.push({ count, resolve });
    });
  }

  release(invocationId: string): void {
    const resolve = this.releases.get(invocationId);
    if (!resolve) throw new Error(`Invocation ${invocationId} is not blocked`);
    this.releases.delete(invocationId);
    resolve({ status: "COMPLETED" });
  }

  private notifyWaiters(): void {
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.waiters[index];
      if (waiter && this.started.size >= waiter.count) {
        this.waiters.splice(index, 1);
        waiter.resolve();
      }
    }
  }
}

type SeedInvocation = {
  key: string;
  status: "PENDING" | "READY" | "RUNNING";
  failurePolicy?: "FAIL_PLAN" | "CONTINUE";
  joinPolicy?: "ALL_REQUIRED" | "ANY_REQUIRED" | "ALL_SETTLED";
};

type SeedDependency = {
  from: string;
  to: string;
  condition: "ON_SUCCESS" | "ON_FAILURE" | "ALWAYS" | "OUTCOME";
  outcome?: string;
};

type SeededPlan = {
  planId: string;
  invocationIds: Record<string, string>;
};

const logger = {
  info: (_fields: Record<string, string | number | boolean | null>, _message: string) => undefined,
  warn: (_fields: Record<string, string | number | boolean | null>, _message: string) => undefined,
  error: (_fields: Record<string, string | number | boolean | null>, _message: string) => undefined,
};

describe("orchestration runtime", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createPrismaClient(testDatabaseUrl);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("claims duplicate execution delivery once and advances a sequential DAG", async () => {
    const seeded = await seedPlan(
      prisma,
      [
        { key: "prompt", status: "READY" },
        { key: "image", status: "PENDING" },
      ],
      [{ from: "prompt", to: "image", condition: "ON_SUCCESS" }],
      1,
    );
    const dispatchQueue = new MemoryQueue();
    const executionQueue = new MemoryQueue();
    const executor = new ScriptedExecutor(() => ({ status: "COMPLETED" }));
    const runtime = new OrchestrationRuntime(prisma, dispatchQueue, executionQueue, logger, {
      executorRegistry: executor,
    });

    await runtime.dispatchPlan(seeded.planId);
    const promptJob = executionQueue.take(INVOCATION_EXECUTE_JOB_NAME);
    expect(promptJob.data.invocationId).toBe(seeded.invocationIds.prompt);

    await runtime.processInvocation(promptJob.data.planId ?? "", promptJob.data.invocationId ?? "");
    await runtime.processInvocation(promptJob.data.planId ?? "", promptJob.data.invocationId ?? "");
    expect(executor.calls).toHaveLength(1);

    await runtime.dispatchPlan(seeded.planId);
    const imageJob = executionQueue.take(INVOCATION_EXECUTE_JOB_NAME);
    expect(imageJob.data.invocationId).toBe(seeded.invocationIds.image);
    await runtime.processInvocation(imageJob.data.planId ?? "", imageJob.data.invocationId ?? "");
    await runtime.dispatchPlan(seeded.planId);

    const plan = await prisma.executionPlan.findUniqueOrThrow({ where: { id: seeded.planId } });
    const runs = await prisma.invocationRun.findMany({
      where: { invocation: { planId: seeded.planId } },
    });
    expect(plan.status).toBe("COMPLETED");
    expect(runs).toHaveLength(2);
    expect(executor.calls).toHaveLength(2);
  });

  it("runs independent branches concurrently without exceeding maxParallelism", async () => {
    const seeded = await seedPlan(
      prisma,
      [
        { key: "a", status: "READY" },
        { key: "b", status: "READY" },
        { key: "c", status: "READY" },
      ],
      [],
      2,
    );
    const dispatchQueue = new MemoryQueue();
    const executionQueue = new MemoryQueue();
    const executor = new BlockingExecutor();
    const runtime = new OrchestrationRuntime(prisma, dispatchQueue, executionQueue, logger, {
      executorRegistry: executor,
    });

    await runtime.dispatchPlan(seeded.planId);
    expect(executionQueue.count(INVOCATION_EXECUTE_JOB_NAME)).toBe(2);
    const firstJob = executionQueue.take(INVOCATION_EXECUTE_JOB_NAME);
    const secondJob = executionQueue.take(INVOCATION_EXECUTE_JOB_NAME);

    const firstRun = runtime.processInvocation(firstJob.data.planId ?? "", firstJob.data.invocationId ?? "");
    const secondRun = runtime.processInvocation(secondJob.data.planId ?? "", secondJob.data.invocationId ?? "");
    await executor.waitForCount(2);

    const active = await prisma.invocation.findMany({
      where: { planId: seeded.planId },
      select: { id: true, status: true },
    });
    expect(active.filter((invocation) => invocation.status === "RUNNING")).toHaveLength(2);
    expect(active.filter((invocation) => invocation.status === "READY")).toHaveLength(1);

    executor.release(firstJob.data.invocationId ?? "");
    await firstRun;
    await runtime.dispatchPlan(seeded.planId);
    expect(executionQueue.count(INVOCATION_EXECUTE_JOB_NAME)).toBe(1);
    const thirdJob = executionQueue.take(INVOCATION_EXECUTE_JOB_NAME);
    expect(thirdJob.data.invocationId).not.toBe(firstJob.data.invocationId);
    expect(thirdJob.data.invocationId).not.toBe(secondJob.data.invocationId);

    executor.release(secondJob.data.invocationId ?? "");
    await secondRun;
    const thirdRun = runtime.processInvocation(thirdJob.data.planId ?? "", thirdJob.data.invocationId ?? "");
    await executor.waitForCount(3);
    executor.release(thirdJob.data.invocationId ?? "");
    await thirdRun;
    await runtime.dispatchPlan(seeded.planId);

    const plan = await prisma.executionPlan.findUniqueOrThrow({ where: { id: seeded.planId } });
    expect(plan.status).toBe("COMPLETED");
  });

  it("skips an ON_SUCCESS branch after a CONTINUE failure and completes the plan as PARTIAL", async () => {
    const seeded = await seedPlan(
      prisma,
      [
        { key: "source", status: "READY", failurePolicy: "CONTINUE" },
        { key: "success-only", status: "PENDING" },
      ],
      [{ from: "source", to: "success-only", condition: "ON_SUCCESS" }],
      1,
    );
    const dispatchQueue = new MemoryQueue();
    const executionQueue = new MemoryQueue();
    const executor = new ScriptedExecutor(() => ({
      status: "FAILED",
      errorCode: "MOCK_TERMINAL_FAILURE",
      retryable: false,
    }));
    const runtime = new OrchestrationRuntime(prisma, dispatchQueue, executionQueue, logger, {
      executorRegistry: executor,
    });

    await runtime.dispatchPlan(seeded.planId);
    const sourceJob = executionQueue.take(INVOCATION_EXECUTE_JOB_NAME);
    await runtime.processInvocation(sourceJob.data.planId ?? "", sourceJob.data.invocationId ?? "");
    await runtime.dispatchPlan(seeded.planId);

    const invocations = await prisma.invocation.findMany({
      where: { planId: seeded.planId },
      select: { id: true, status: true },
    });
    const statusById = new Map(invocations.map((invocation) => [invocation.id, invocation.status]));
    const plan = await prisma.executionPlan.findUniqueOrThrow({ where: { id: seeded.planId } });
    expect(statusById.get(seeded.invocationIds.source ?? "")).toBe("FAILED");
    expect(statusById.get(seeded.invocationIds["success-only"] ?? "")).toBe("SKIPPED");
    expect(plan.status).toBe("PARTIAL");
    expect(executor.calls).toHaveLength(1);
  });

  it("keeps usage backpressure non-terminal and only rechecks after bounded backoff", async () => {
    const seeded = await seedPlan(prisma, [{ key: "paid", status: "READY" }], [], 1);
    const dispatchQueue = new MemoryQueue();
    const executionQueue = new MemoryQueue();
    const executor = new ScriptedExecutor((_input, callNumber) =>
      callNumber === 1
        ? {
            status: "WAITING_FOR_USAGE_CAPACITY",
            errorCode: "BILLING_INSUFFICIENT_USAGE",
          }
        : { status: "COMPLETED" },
    );
    const runtime = new OrchestrationRuntime(prisma, dispatchQueue, executionQueue, logger, {
      executorRegistry: executor,
      usageRecheckBaseMs: 1,
      usageRecheckMaxMs: 1,
    });

    await runtime.dispatchPlan(seeded.planId);
    const firstJob = executionQueue.take(INVOCATION_EXECUTE_JOB_NAME);
    await runtime.processInvocation(firstJob.data.planId ?? "", firstJob.data.invocationId ?? "");

    const paused = await prisma.invocation.findUniqueOrThrow({
      where: { id: seeded.invocationIds.paid },
      select: { status: true },
    });
    const planWhilePaused = await prisma.executionPlan.findUniqueOrThrow({
      where: { id: seeded.planId },
      select: { status: true },
    });
    expect(paused.status).toBe("WAITING_FOR_USAGE_CAPACITY");
    expect(planWhilePaused.status).toBe("RUNNING");

    await new Promise((resolve) => setTimeout(resolve, 2));
    await runtime.reconcile();
    await runtime.dispatchPlan(seeded.planId);
    const secondJob = executionQueue.take(INVOCATION_EXECUTE_JOB_NAME);
    await runtime.processInvocation(secondJob.data.planId ?? "", secondJob.data.invocationId ?? "");
    await runtime.dispatchPlan(seeded.planId);

    const completed = await prisma.invocation.findUniqueOrThrow({
      where: { id: seeded.invocationIds.paid },
      select: { status: true },
    });
    expect(completed.status).toBe("COMPLETED");
    expect(executor.calls).toHaveLength(2);
  });

  it("keeps hard insufficient usage blocked instead of failing the plan", async () => {
    const seeded = await seedPlan(prisma, [{ key: "paid", status: "READY" }], [], 1);
    const dispatchQueue = new MemoryQueue();
    const executionQueue = new MemoryQueue();
    const executor = new ScriptedExecutor(() => ({
      status: "BLOCKED_INSUFFICIENT_USAGE",
      errorCode: "BILLING_INSUFFICIENT_USAGE",
    }));
    const runtime = new OrchestrationRuntime(prisma, dispatchQueue, executionQueue, logger, {
      executorRegistry: executor,
      usageRecheckBaseMs: 60_000,
      usageRecheckMaxMs: 60_000,
    });

    await runtime.dispatchPlan(seeded.planId);
    const job = executionQueue.take(INVOCATION_EXECUTE_JOB_NAME);
    await runtime.processInvocation(job.data.planId ?? "", job.data.invocationId ?? "");
    await runtime.dispatchPlan(seeded.planId);

    const invocation = await prisma.invocation.findUniqueOrThrow({
      where: { id: seeded.invocationIds.paid },
      select: { status: true },
    });
    const plan = await prisma.executionPlan.findUniqueOrThrow({
      where: { id: seeded.planId },
      select: { status: true },
    });
    expect(invocation.status).toBe("BLOCKED_INSUFFICIENT_USAGE");
    expect(plan.status).toBe("RUNNING");
    expect(executionQueue.count(INVOCATION_EXECUTE_JOB_NAME)).toBe(0);
  });

  it("retries a retryable mock failure with a new durable InvocationRun attempt", async () => {
    const seeded = await seedPlan(prisma, [{ key: "retry", status: "READY" }], [], 1);
    const dispatchQueue = new MemoryQueue();
    const executionQueue = new MemoryQueue();
    const executor = new ScriptedExecutor((_input, callNumber) =>
      callNumber === 1
        ? { status: "FAILED", errorCode: "MOCK_RETRY", retryable: true }
        : { status: "COMPLETED" },
    );
    const runtime = new OrchestrationRuntime(prisma, dispatchQueue, executionQueue, logger, {
      executorRegistry: executor,
      maxAttempts: 3,
    });

    await runtime.dispatchPlan(seeded.planId);
    const firstJob = executionQueue.take(INVOCATION_EXECUTE_JOB_NAME);
    await runtime.processInvocation(firstJob.data.planId ?? "", firstJob.data.invocationId ?? "");
    await runtime.dispatchPlan(seeded.planId);
    const secondJob = executionQueue.take(INVOCATION_EXECUTE_JOB_NAME);
    await runtime.processInvocation(secondJob.data.planId ?? "", secondJob.data.invocationId ?? "");
    await runtime.dispatchPlan(seeded.planId);

    const runs = await prisma.invocationRun.findMany({
      where: { invocationId: seeded.invocationIds.retry },
      orderBy: { attempt: "asc" },
      select: { attempt: true, status: true, idempotencyKey: true },
    });
    expect(runs.map((run) => [run.attempt, run.status])).toEqual([
      [1, "FAILED"],
      [2, "COMPLETED"],
    ]);
    expect(new Set(runs.map((run) => run.idempotencyKey)).size).toBe(2);
  });

  it("stops retrying after the configured hard attempt ceiling", async () => {
    const seeded = await seedPlan(
      prisma,
      [{ key: "retry-cap", status: "READY" }],
      [],
      1,
    );
    const dispatchQueue = new MemoryQueue();
    const executionQueue = new MemoryQueue();
    const executor = new ScriptedExecutor(() => ({
      status: "FAILED",
      errorCode: "MOCK_RETRY",
      retryable: true,
    }));
    const runtime = new OrchestrationRuntime(
      prisma,
      dispatchQueue,
      executionQueue,
      logger,
      {
        executorRegistry: executor,
        maxAttempts: 2,
      },
    );

    await runtime.dispatchPlan(seeded.planId);
    const firstJob = executionQueue.take(INVOCATION_EXECUTE_JOB_NAME);
    await runtime.processInvocation(
      firstJob.data.planId ?? "",
      firstJob.data.invocationId ?? "",
    );

    await runtime.dispatchPlan(seeded.planId);
    const secondJob = executionQueue.take(INVOCATION_EXECUTE_JOB_NAME);
    await runtime.processInvocation(
      secondJob.data.planId ?? "",
      secondJob.data.invocationId ?? "",
    );
    await runtime.dispatchPlan(seeded.planId);

    const invocationId = seeded.invocationIds["retry-cap"];
    if (!invocationId) throw new Error("Missing retry-cap invocation");
    const runs = await prisma.invocationRun.findMany({
      where: { invocationId },
      orderBy: { attempt: "asc" },
      select: { attempt: true, status: true, errorCode: true },
    });
    const invocation = await prisma.invocation.findUniqueOrThrow({
      where: { id: invocationId },
      select: { status: true },
    });
    const plan = await prisma.executionPlan.findUniqueOrThrow({
      where: { id: seeded.planId },
      select: { status: true },
    });

    expect(runs).toEqual([
      { attempt: 1, status: "FAILED", errorCode: "MOCK_RETRY" },
      { attempt: 2, status: "FAILED", errorCode: "MOCK_RETRY" },
    ]);
    expect(invocation.status).toBe("FAILED");
    expect(plan.status).toBe("FAILED");
    expect(executionQueue.count(INVOCATION_EXECUTE_JOB_NAME)).toBe(0);
  });

  it("rebuilds dispatch delivery from PostgreSQL after queue loss", async () => {
    const seeded = await seedPlan(prisma, [{ key: "root", status: "READY" }], [], 1);
    const dispatchQueue = new MemoryQueue();
    const executionQueue = new MemoryQueue();
    dispatchQueue.failAdds = true;
    const runtime = new OrchestrationRuntime(prisma, dispatchQueue, executionQueue, logger);

    await expect(runtime.reconcile()).rejects.toThrow("redis unavailable");
    const beforeRecovery = await prisma.invocation.findUniqueOrThrow({
      where: { id: seeded.invocationIds.root },
      select: { status: true },
    });
    expect(beforeRecovery.status).toBe("READY");

    dispatchQueue.failAdds = false;
    await runtime.reconcile();
    expect(dispatchQueue.count(ORCHESTRATION_DISPATCH_JOB_NAME)).toBeGreaterThanOrEqual(1);
    const dispatchJobEntry = [...dispatchQueue.jobs.entries()].find(
      ([, job]) => job.name === ORCHESTRATION_DISPATCH_JOB_NAME && job.data.planId === seeded.planId,
    );
    expect(dispatchJobEntry).toBeDefined();
    if (!dispatchJobEntry) throw new Error("Missing recovered dispatch job for seeded plan");
    dispatchQueue.jobs.delete(dispatchJobEntry[0]);
    await runtime.dispatchPlan(dispatchJobEntry[1].data.planId ?? "");
    expect(executionQueue.count(INVOCATION_EXECUTE_JOB_NAME)).toBe(1);
  });

  it("marks abandoned semantic PLANNING shells failed during reconciliation", async () => {
    const suffix = randomUUID();
    const userId = `planning-recovery-user-${suffix}`;
    const conversationId = randomUUID();
    const messageId = randomUUID();
    const planId = randomUUID();

    await prisma.user.create({
      data: {
        id: userId,
        name: "Planning Recovery",
        email: `${suffix}@planning-recovery.test`,
        emailVerified: true,
      },
    });
    await prisma.conversation.create({
      data: { id: conversationId, userId, title: "Planning recovery", kind: "CHAT" },
    });
    await prisma.message.create({
      data: {
        id: messageId,
        conversationId,
        role: "USER",
        content: "@auto recover me",
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
        planHash: "planning:claimed:abandoned",
        goal: "Planning workflow",
        status: "PLANNING",
        maxParallelism: 1,
        updatedAt: new Date(Date.now() - 60_000),
      },
    });

    const runtime = new OrchestrationRuntime(
      prisma,
      new MemoryQueue(),
      new MemoryQueue(),
      logger,
      { planningStaleAfterMs: 1_000 },
    );
    await runtime.reconcile();

    const recovered = await prisma.executionPlan.findUniqueOrThrow({
      where: { id: planId },
      select: { status: true, completedAt: true },
    });
    expect(recovered.status).toBe("FAILED");
    expect(recovered.completedAt).not.toBeNull();
  });

  it("recovers a stale RUNNING attempt to READY before redispatch", async () => {
    const seeded = await seedPlan(prisma, [{ key: "stale", status: "RUNNING" }], [], 1);
    const invocationId = seeded.invocationIds.stale ?? "";
    const staleRun = await prisma.invocationRun.create({
      data: {
        invocationId,
        attempt: 1,
        idempotencyKey: `stale-${randomUUID()}`,
        status: "RUNNING",
        startedAt: new Date(Date.now() - 60_000),
      },
    });
    const dispatchQueue = new MemoryQueue();
    const executionQueue = new MemoryQueue();
    const runtime = new OrchestrationRuntime(prisma, dispatchQueue, executionQueue, logger, {
      staleAfterMs: 1_000,
      maxAttempts: 3,
    });

    await runtime.reconcile();

    const invocation = await prisma.invocation.findUniqueOrThrow({
      where: { id: invocationId },
      select: { status: true },
    });
    const run = await prisma.invocationRun.findUniqueOrThrow({
      where: { id: staleRun.id },
      select: { status: true, errorCode: true },
    });
    expect(invocation.status).toBe("READY");
    expect(run).toEqual({ status: "FAILED", errorCode: "WORKER_INTERRUPTED" });
    expect(dispatchQueue.count(ORCHESTRATION_DISPATCH_JOB_NAME)).toBeGreaterThanOrEqual(1);
  });
});

async function seedPlan(
  prisma: PrismaClient,
  invocations: readonly SeedInvocation[],
  dependencies: readonly SeedDependency[],
  maxParallelism: number,
): Promise<SeededPlan> {
  const suffix = randomUUID();
  const userId = `orchestration-runtime-user-${suffix}`;
  const conversationId = randomUUID();
  const messageId = randomUUID();
  const planId = randomUUID();
  const invocationIds = Object.fromEntries(
    invocations.map((invocation) => [invocation.key, `${planId}:inv:${invocation.key}`]),
  );

  await prisma.user.create({
    data: {
      id: userId,
      name: "Orchestration Runtime Test",
      email: `${suffix}@orchestration-runtime.test`,
      emailVerified: true,
    },
  });
  await prisma.conversation.create({
    data: { id: conversationId, userId, title: "Runtime test", kind: "CHAT" },
  });
  await prisma.message.create({
    data: {
      id: messageId,
      conversationId,
      role: "USER",
      content: "Execute the test DAG",
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
      goal: "Exercise the BullMQ DAG runtime",
      status: "RUNNING",
      maxParallelism,
      startedAt: new Date(),
      frozenAt: new Date(),
    },
  });
  await prisma.invocation.createMany({
    data: invocations.map((invocation, sequence) => ({
      id: invocationIds[invocation.key] ?? `${planId}:missing:${sequence}`,
      planId,
      sequence,
      purpose: `Execute ${invocation.key}`,
      targetKind: "VIMLA",
      targetModelSlug: null,
      targetAgentId: null,
      outputDeclarations: [],
      acceptanceCriteria: [],
      riskClass: "READ_ONLY",
      approvalPolicy: "AUTO",
      failurePolicy: invocation.failurePolicy ?? "FAIL_PLAN",
      joinPolicy: invocation.joinPolicy ?? "ALL_REQUIRED",
      status: invocation.status,
    })),
  });
  if (dependencies.length > 0) {
    await prisma.invocationDependency.createMany({
      data: dependencies.map((dependency, index) => ({
        id: `${planId}:dep:${index}`,
        planId,
        fromInvocationId: invocationIds[dependency.from] ?? "missing-source",
        toInvocationId: invocationIds[dependency.to] ?? "missing-target",
        conditionKind: dependency.condition,
        conditionOutcome: dependency.condition === "OUTCOME" ? (dependency.outcome ?? "PASS") : "",
        inputBindings: [],
      })),
    });
  }

  return { planId, invocationIds };
}