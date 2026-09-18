import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@vimla/database";
import type { PlannerPlan } from "@vimla/operator";
import {
  DeterministicVimlaToolPlanner,
  VimlaInvocationExecutor,
  type VimlaToolPlanner,
  type VimlaToolPlannerInput,
  vimlaToolIdempotencyKey,
} from "./vimla-invocation-executor.js";
import type { InvocationExecutionInput } from "./orchestration.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

describe("VimlaInvocationExecutor", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createPrismaClient(testDatabaseUrl);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a task through the existing typed workspace tool stack and records its object id", async () => {
    const seeded = await seedInvocation(prisma, "создай задачу «PR-08 task»");
    const executor = new VimlaInvocationExecutor(
      prisma,
      new DeterministicVimlaToolPlanner(),
      "en",
    );

    const result = await executor.execute(executionInput(seeded, 1));

    expect(result).toEqual({ status: "COMPLETED", outcome: "PASS" });

    const tasks = await prisma.workspaceObject.findMany({
      where: {
        personalOwnerUserId: seeded.userId,
        kind: "TASK",
        deletedAt: null,
      },
      include: { task: true },
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.task?.title).toBe("PR-08 task");

    const execution = await prisma.toolExecution.findUniqueOrThrow({
      where: { idempotencyKey: vimlaToolIdempotencyKey(seeded.invocationId) },
    });
    expect(execution.status).toBe("COMPLETED");
    expect(execution.toolName).toBe("tasks.create");
    expect(execution.objectId).toBe(tasks[0]?.id);
  });

  it("creates a reminder through existing services", async () => {
    const seeded = await seedInvocation(prisma, "создай напоминание «Review PR-08»");
    const executor = new VimlaInvocationExecutor(
      prisma,
      new DeterministicVimlaToolPlanner(),
      "en",
    );

    const result = await executor.execute(executionInput(seeded, 1));

    expect(result).toEqual({ status: "COMPLETED", outcome: "PASS" });
    const reminders = await prisma.workspaceObject.findMany({
      where: {
        personalOwnerUserId: seeded.userId,
        kind: "REMINDER",
        deletedAt: null,
      },
      include: { reminder: true },
    });
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.reminder?.title).toBe("Review PR-08");
  });

  it("reuses the invocation-level ToolExecution on retry and never duplicates the side effect", async () => {
    const seeded = await seedInvocation(prisma, "создай задачу «Idempotent task»");
    const executor = new VimlaInvocationExecutor(
      prisma,
      new DeterministicVimlaToolPlanner(),
      "en",
    );

    const first = await executor.execute(executionInput(seeded, 1));
    expect(first.status).toBe("COMPLETED");

    const secondRun = await prisma.invocationRun.create({
      data: {
        invocationId: seeded.invocationId,
        attempt: 2,
        idempotencyKey: `${seeded.invocationId}:attempt:2`,
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    const second = await executor.execute({
      ...executionInput(seeded, 2),
      runId: secondRun.id,
      idempotencyKey: secondRun.idempotencyKey,
    });

    expect(second).toEqual({ status: "COMPLETED", outcome: "REPLAYED" });
    expect(
      await prisma.workspaceObject.count({
        where: {
          personalOwnerUserId: seeded.userId,
          kind: "TASK",
          task: { is: { title: "Idempotent task" } },
        },
      }),
    ).toBe(1);
    expect(
      await prisma.toolExecution.count({
        where: { idempotencyKey: vimlaToolIdempotencyKey(seeded.invocationId) },
      }),
    ).toBe(1);
  });

  it("preserves workspace authorization and rolls back ToolExecution when a command targets another user's object", async () => {
    const actor = await seedInvocation(prisma, "attempt unauthorized update");
    const victimId = `victim-${randomUUID()}`;
    await prisma.user.create({
      data: {
        id: victimId,
        name: "Victim",
        email: `${randomUUID()}@vimla-pr08.test`,
        emailVerified: true,
      },
    });
    const victimTask = await prisma.workspaceObject.create({
      data: {
        kind: "TASK",
        scopeType: "PERSONAL",
        personalOwnerUserId: victimId,
        createdByUserId: victimId,
        task: {
          create: {
            title: "Victim task",
            status: "TODO",
          },
        },
      },
    });

    const executor = new VimlaInvocationExecutor(
      prisma,
      new StaticPlanner({
        intent: "act",
        userMessage: "update",
        clarificationQuestion: null,
        commands: [
          {
            tool: "tasks.update",
            args: { id: victimTask.id, title: "Should not change" },
          },
        ],
      }),
      "en",
    );

    const result = await executor.execute(executionInput(actor, 1));

    expect(result).toEqual({
      status: "FAILED",
      errorCode: "WORKSPACE_NOT_FOUND",
      retryable: false,
    });
    const unchanged = await prisma.workspaceTask.findUniqueOrThrow({
      where: { objectId: victimTask.id },
    });
    expect(unchanged.title).toBe("Victim task");
    expect(
      await prisma.toolExecution.count({
        where: { idempotencyKey: vimlaToolIdempotencyKey(actor.invocationId) },
      }),
    ).toBe(0);
  });
});

class StaticPlanner implements VimlaToolPlanner {
  constructor(private readonly result: PlannerPlan) {}

  async plan(_input: VimlaToolPlannerInput): Promise<PlannerPlan> {
    return this.result;
  }
}

type SeededInvocation = {
  userId: string;
  planId: string;
  invocationId: string;
  runId: string;
  runIdempotencyKey: string;
};

async function seedInvocation(
  prisma: PrismaClient,
  purpose: string,
): Promise<SeededInvocation> {
  const suffix = randomUUID();
  const userId = `vimla-executor-user-${suffix}`;
  const conversationId = randomUUID();
  const messageId = randomUUID();
  const planId = randomUUID();
  const invocationId = randomUUID();

  await prisma.user.create({
    data: {
      id: userId,
      name: "Vimla Executor Test",
      email: `${suffix}@vimla-executor.test`,
      emailVerified: true,
      preference: {
        create: {
          locale: "en",
          timezone: "UTC",
        },
      },
    },
  });
  await prisma.conversation.create({
    data: {
      id: conversationId,
      userId,
      title: "PR-08 executor",
      kind: "CHAT",
    },
  });
  await prisma.message.create({
    data: {
      id: messageId,
      conversationId,
      role: "USER",
      content: purpose,
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
      goal: purpose,
      status: "RUNNING",
      maxParallelism: 1,
      startedAt: new Date(),
      frozenAt: new Date(),
    },
  });
  await prisma.invocation.create({
    data: {
      id: invocationId,
      planId,
      sequence: 0,
      purpose,
      targetKind: "VIMLA",
      targetModelSlug: null,
      targetAgentId: null,
      outputDeclarations: [],
      acceptanceCriteria: [],
      riskClass: "INTERNAL_WRITE",
      approvalPolicy: "AUTO",
      failurePolicy: "FAIL_PLAN",
      joinPolicy: "ALL_REQUIRED",
      status: "RUNNING",
    },
  });
  const run = await prisma.invocationRun.create({
    data: {
      invocationId,
      attempt: 1,
      idempotencyKey: `${invocationId}:attempt:1`,
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  return {
    userId,
    planId,
    invocationId,
    runId: run.id,
    runIdempotencyKey: run.idempotencyKey,
  };
}

function executionInput(
  seeded: SeededInvocation,
  attempt: number,
): InvocationExecutionInput {
  return {
    planId: seeded.planId,
    invocationId: seeded.invocationId,
    attempt,
    runId: seeded.runId,
    idempotencyKey: seeded.runIdempotencyKey,
    target: {
      kind: "VIMLA",
      modelSlug: null,
      agentId: null,
    },
  };
}
