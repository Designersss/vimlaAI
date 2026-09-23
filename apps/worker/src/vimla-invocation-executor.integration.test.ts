import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArtifactService } from "@vimla/artifacts";
import type { ContextBundleView } from "@vimla/context";
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

  it("passes DATA dependency artifacts to the Vimla tool planner as untrusted execution context", async () => {
    const seeded = await seedInvocation(
      prisma,
      "Create a reminder using the provided prompt artifact",
    );
    const sourceInvocationId = randomUUID();
    await prisma.invocation.create({
      data: {
        id: sourceInvocationId,
        planId: seeded.planId,
        sequence: 99,
        purpose: "Produce the reminder text",
        targetKind: "AI_AUTO",
        targetModelSlug: null,
        targetAgentId: null,
        outputDeclarations: [
          { name: "prompt", artifactType: "PROMPT" },
        ],
        acceptanceCriteria: [],
        riskClass: "READ_ONLY",
        approvalPolicy: "AUTO",
        failurePolicy: "FAIL_PLAN",
        joinPolicy: "ALL_REQUIRED",
        status: "COMPLETED",
      },
    });
    const artifacts = new ArtifactService(prisma);
    await artifacts.createArtifact({
      actorUserId: seeded.userId,
      creatorInvocationId: sourceInvocationId,
      outputName: "prompt",
      type: "PROMPT",
      classification: "PRIVATE",
      content: {
        kind: "INLINE_JSON",
        value: { text: "Review the generated campaign prompt" },
      },
    });
    await prisma.invocationDependency.create({
      data: {
        id: randomUUID(),
        planId: seeded.planId,
        fromInvocationId: sourceInvocationId,
        toInvocationId: seeded.invocationId,
        conditionKind: "DATA",
        conditionOutcome: "",
        inputBindings: [
          {
            inputName: "prompt",
            sourceOutputName: "prompt",
            expectedArtifactType: "PROMPT",
          },
        ],
      },
    });

    const planner = new CapturingPlanner({
      intent: "act",
      userMessage: "context received",
      clarificationQuestion: null,
      commands: [{ tool: "profile.getSafe", args: {} }],
    });
    const executor = new VimlaInvocationExecutor(prisma, planner, "en");

    await expect(
      executor.execute(executionInput(seeded, 1)),
    ).resolves.toEqual({ status: "COMPLETED", outcome: "PASS" });
    expect(planner.input?.dependencyContext).toContain("INPUT prompt");
    expect(planner.input?.dependencyContext).toContain("PROMPT");
    expect(planner.input?.dependencyContext).toContain(
      "Review the generated campaign prompt",
    );
  });

  it("passes sanitized packed ContextBundle items to the Vimla planner", async () => {
    const seeded = await seedInvocation(
      prisma,
      "Use the authorized project context",
    );
    const planner = new CapturingPlanner({
      intent: "act",
      userMessage: "context received",
      clarificationQuestion: null,
      commands: [{ tool: "profile.getSafe", args: {} }],
    });
    const executor = new VimlaInvocationExecutor(prisma, planner, "en");
    const internalOwnerId = "internal-owner-" + randomUUID();

    await expect(
      executor.execute({
        ...executionInput(seeded, 1),
        contextBundle: contextBundleWithMessage(
          seeded,
          internalOwnerId,
        ),
      }),
    ).resolves.toEqual({ status: "COMPLETED", outcome: "PASS" });

    expect(planner.input?.dependencyContext).toContain(
      "The authorized release decision is violet.",
    );
    expect(planner.input?.dependencyContext).not.toContain(
      internalOwnerId,
    );
    expect(planner.input?.dependencyContext).not.toContain(
      "lexicalScore",
    );
    expect(planner.input?.dependencyContext).not.toContain(
      "retrieval reason",
    );
  });

  it("fails closed when a write-class Vimla invocation cannot be resolved to a tool action", async () => {
    const seeded = await seedInvocation(prisma, "perform the requested workspace change");
    const executor = new VimlaInvocationExecutor(
      prisma,
      new StaticPlanner({
        intent: "answer",
        userMessage: "I could not resolve an action",
        clarificationQuestion: null,
        commands: [],
      }),
      "en",
    );

    await expect(
      executor.execute(executionInput(seeded, 1)),
    ).resolves.toEqual({
      status: "FAILED",
      errorCode: "VIMLA_ACTION_NOT_RESOLVED",
      retryable: false,
    });
  });

  it("requires orchestration approval for destructive Vimla tools and accepts an already-approved invocation", async () => {
    const unapproved = await seedInvocation(
      prisma,
      "delete my task",
      "AUTO",
    );
    const unapprovedTask = await prisma.workspaceObject.create({
      data: {
        kind: "TASK",
        scopeType: "PERSONAL",
        personalOwnerUserId: unapproved.userId,
        createdByUserId: unapproved.userId,
        task: { create: { title: "Keep until approved", status: "TODO" } },
      },
    });
    const unapprovedExecutor = new VimlaInvocationExecutor(
      prisma,
      new StaticPlanner({
        intent: "act",
        userMessage: "delete",
        clarificationQuestion: null,
        commands: [
          {
            tool: "tasks.delete",
            args: { id: unapprovedTask.id },
          },
        ],
      }),
      "en",
    );

    await expect(
      unapprovedExecutor.execute(executionInput(unapproved, 1)),
    ).resolves.toEqual({
      status: "FAILED",
      errorCode: "VIMLA_CONFIRMATION_REQUIRED",
      retryable: false,
    });
    expect(
      await prisma.workspaceObject.findUniqueOrThrow({
        where: { id: unapprovedTask.id },
        select: { deletedAt: true },
      }),
    ).toEqual({ deletedAt: null });

    const approved = await seedInvocation(
      prisma,
      "delete my approved task",
      "USER_CONFIRMATION",
    );
    const approvedTask = await prisma.workspaceObject.create({
      data: {
        kind: "TASK",
        scopeType: "PERSONAL",
        personalOwnerUserId: approved.userId,
        createdByUserId: approved.userId,
        task: { create: { title: "Delete after approval", status: "TODO" } },
      },
    });
    const approvedExecutor = new VimlaInvocationExecutor(
      prisma,
      new StaticPlanner({
        intent: "act",
        userMessage: "delete",
        clarificationQuestion: null,
        commands: [
          {
            tool: "tasks.delete",
            args: { id: approvedTask.id },
          },
        ],
      }),
      "en",
    );

    await expect(
      approvedExecutor.execute(executionInput(approved, 1)),
    ).resolves.toEqual({ status: "COMPLETED", outcome: "PASS" });
    expect(
      (
        await prisma.workspaceObject.findUniqueOrThrow({
          where: { id: approvedTask.id },
          select: { deletedAt: true },
        })
      ).deletedAt,
    ).not.toBeNull();
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

class CapturingPlanner implements VimlaToolPlanner {
  input: VimlaToolPlannerInput | null = null;

  constructor(private readonly result: PlannerPlan) {}

  async plan(input: VimlaToolPlannerInput): Promise<PlannerPlan> {
    this.input = input;
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
  approvalPolicy: "AUTO" | "USER_CONFIRMATION" = "AUTO",
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
      approvalPolicy,
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

function contextBundleWithMessage(
  seeded: SeededInvocation,
  internalOwnerId: string,
): ContextBundleView {
  return {
    id: "vimla-context-bundle",
    invocationId: seeded.invocationId,
    snapshotId: "vimla-context-snapshot",
    fingerprint: "sha256:vimla-context-bundle",
    manifest: {
      version: 1,
      packingVersion: 1,
      targetKind: "VIMLA",
      surfaceKind: "PERSONAL",
      surfaceScopeHash: "sha256:personal",
      audienceParticipantCount: 1,
      budget: {
        contextWindowTokens: 32_768,
        outputReserveTokens: 4_096,
        systemToolReserveTokens: 2_048,
        artifactReserveTokens: 4_096,
        safetyMarginTokens: 2_621,
        effectiveHistoryBudgetTokens: 19_907,
        compactedStateTriggerTokens: 15_925,
      },
      usedTokens: 24,
      rawHistoryTokens: 24,
      compactedStateRequired: false,
      allowedItems: [
        {
          snapshotItemId: "vimla-context-item",
          sourceType: "MESSAGE",
          classification: "PRIVATE",
          fingerprint: "sha256:vimla-context-item",
          estimatedTokens: 24,
          selectionReason: "RELEVANT",
        },
      ],
      allowedArtifacts: [],
      denials: [],
      packingExclusions: [],
      artifactDenials: [],
    },
    items: [
      {
        id: "vimla-context-item",
        sequence: 0,
        sourceType: "MESSAGE",
        sourceId: "vimla-context-message",
        sourceVersion: "v1",
        classification: "PRIVATE",
        contentRef: "vimla://messages/vimla-context-message",
        metadata: {
          role: "ASSISTANT",
          content: "The authorized release decision is violet.",
          retrieval: {
            sourceKind: "CROSS_CONVERSATION",
            scope: {
              kind: "PERSONAL",
              ownerUserId: internalOwnerId,
            },
            reason: "retrieval reason",
            lexicalScore: 0.91,
          },
        },
        fingerprint: "sha256:vimla-context-item",
        createdAt: new Date().toISOString(),
      },
    ],
    artifacts: [],
    createdAt: new Date().toISOString(),
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
