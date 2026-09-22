import { randomUUID } from "node:crypto";
import { ArtifactService } from "@vimla/artifacts";
import { createPrismaClient, type Prisma, type PrismaClient } from "@vimla/database";
import type { EvaluationResult } from "@vimla/orchestration";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EvaluatorInvocationExecutor,
  type AiEvaluationModel,
} from "./evaluator-invocation-executor.js";
import type { InvocationExecutionInput } from "./orchestration.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

class CountingAiModel implements AiEvaluationModel {
  calls = 0;

  constructor(private readonly result: EvaluationResult) {}

  async evaluate(): Promise<EvaluationResult> {
    this.calls += 1;
    return this.result;
  }
}

describe("EvaluatorInvocationExecutor", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createPrismaClient(testDatabaseUrl);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("evaluates deterministic criteria without invoking AI and persists FAIL outcome", async () => {
    const seeded = await seedEvaluator(prisma, {
      mode: "DETERMINISTIC",
      criterion: {
        id: "contains-approved",
        description: "Result must contain approved",
        mode: "DETERMINISTIC",
        binding: {
          kind: "TEXT_CONTAINS",
          inputName: "result",
          value: "approved",
        },
      },
      artifactValue: { text: "generated result needs revision" },
    });
    const model = new CountingAiModel({
      mode: "AI_EVALUATOR",
      outcome: "PASS",
      confidence: 1,
      criteriaResults: [
        {
          criterionId: "contains-approved",
          outcome: "PASS",
          confidence: 1,
        },
      ],
    });
    const executor = new EvaluatorInvocationExecutor(prisma, model);

    const result = await executor.execute(executionInput(seeded));

    expect(result).toEqual({ status: "COMPLETED", outcome: "FAIL" });
    expect(model.calls).toBe(0);

    const evaluation = await prisma.evaluation.findUniqueOrThrow({
      where: { invocationRunId: seeded.runId },
    });
    expect(evaluation).toMatchObject({
      evaluatorKind: "DETERMINISTIC",
      outcome: "FAIL",
      confidence: 1,
    });

    const artifact = await prisma.artifact.findUniqueOrThrow({
      where: {
        creatorInvocationId_outputName: {
          creatorInvocationId: seeded.evaluatorInvocationId,
          outputName: "evaluation",
        },
      },
      include: { versions: true },
    });
    expect(artifact.type).toBe("JSON");
    expect(artifact.versions[0]?.contentJson).toMatchObject({
      mode: "DETERMINISTIC",
      outcome: "FAIL",
      confidence: 1,
    });
  });

  it("uses the dedicated AI evaluator model port and validates its typed result", async () => {
    const seeded = await seedEvaluator(prisma, {
      mode: "AI_EVALUATOR",
      criterion: {
        id: "quality",
        description: "Generated result should satisfy the requested quality bar",
        mode: "AI_EVALUATOR",
      },
      artifactValue: { text: "candidate result" },
    });
    const model = new CountingAiModel({
      mode: "AI_EVALUATOR",
      outcome: "PASS",
      confidence: 0.86,
      criteriaResults: [
        {
          criterionId: "quality",
          outcome: "PASS",
          confidence: 0.86,
          summary: "Quality bar satisfied.",
        },
      ],
      summary: "Accepted.",
    });
    const executor = new EvaluatorInvocationExecutor(prisma, model);

    await expect(executor.execute(executionInput(seeded))).resolves.toEqual({
      status: "COMPLETED",
      outcome: "PASS",
    });
    expect(model.calls).toBe(1);

    const evaluation = await prisma.evaluation.findUniqueOrThrow({
      where: { invocationRunId: seeded.runId },
    });
    expect(evaluation).toMatchObject({
      evaluatorKind: "AI_EVALUATOR",
      outcome: "PASS",
      confidence: 0.86,
      summary: "Accepted.",
    });

    const retryRun = await prisma.invocationRun.create({
      data: {
        invocationId: seeded.evaluatorInvocationId,
        attempt: 2,
        idempotencyKey: `${seeded.evaluatorInvocationId}:attempt:2`,
        status: "RUNNING",
        startedAt: new Date(),
      },
    });
    await expect(
      executor.execute({
        ...executionInput(seeded),
        attempt: 2,
        runId: retryRun.id,
        idempotencyKey: retryRun.idempotencyKey,
      }),
    ).resolves.toEqual({
      status: "COMPLETED",
      outcome: "PASS",
    });
    expect(model.calls).toBe(1);
    expect(
      await prisma.evaluation.count({
        where: {
          invocationRun: {
            invocationId: seeded.evaluatorInvocationId,
          },
        },
      }),
    ).toBe(2);
    expect(
      await prisma.artifact.count({
        where: {
          creatorInvocationId: seeded.evaluatorInvocationId,
          outputName: "evaluation",
        },
      }),
    ).toBe(1);

    const sourceArtifact = await prisma.artifact.findUniqueOrThrow({
      where: {
        creatorInvocationId_outputName: {
          creatorInvocationId: seeded.sourceInvocationId,
          outputName: "result",
        },
      },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    const sourceVersion = sourceArtifact.versions[0];
    if (!sourceVersion) throw new Error("Missing source artifact version");
    const artifacts = new ArtifactService(prisma);
    await artifacts.createVersion({
      actorUserId: seeded.userId,
      artifactId: sourceArtifact.id,
      expectedCurrentVersion: sourceVersion.version,
      content: {
        kind: "INLINE_JSON",
        value: { text: "candidate result changed after evaluation" },
      },
    });

    const changedRun = await prisma.invocationRun.create({
      data: {
        invocationId: seeded.evaluatorInvocationId,
        attempt: 3,
        idempotencyKey: `${seeded.evaluatorInvocationId}:attempt:3`,
        status: "RUNNING",
        startedAt: new Date(),
      },
    });
    await expect(
      executor.execute({
        ...executionInput(seeded),
        attempt: 3,
        runId: changedRun.id,
        idempotencyKey: changedRun.idempotencyKey,
      }),
    ).resolves.toEqual({
      status: "FAILED",
      errorCode: "EVALUATOR_INPUT_CHANGED",
      retryable: false,
    });
    expect(model.calls).toBe(1);
  });
});

type SeededEvaluator = {
  planId: string;
  userId: string;
  sourceInvocationId: string;
  evaluatorInvocationId: string;
  runId: string;
  idempotencyKey: string;
};

async function seedEvaluator(
  prisma: PrismaClient,
  input: {
    mode: "DETERMINISTIC" | "AI_EVALUATOR";
    criterion: Prisma.InputJsonObject;
    artifactValue: Prisma.InputJsonObject;
  },
): Promise<SeededEvaluator> {
  const suffix = randomUUID();
  const userId = `evaluator-user-${suffix}`;
  const conversationId = randomUUID();
  const messageId = randomUUID();
  const planId = randomUUID();
  const sourceInvocationId = randomUUID();
  const evaluatorInvocationId = randomUUID();

  await prisma.user.create({
    data: {
      id: userId,
      name: "Evaluator Test",
      email: `${suffix}@evaluator.test`,
      emailVerified: true,
    },
  });
  await prisma.conversation.create({
    data: {
      id: conversationId,
      userId,
      title: "Evaluator integration",
      kind: "CHAT",
    },
  });
  await prisma.message.create({
    data: {
      id: messageId,
      conversationId,
      role: "USER",
      content: "Evaluate the generated result",
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
      goal: "Evaluate the generated artifact",
      status: "RUNNING",
      maxParallelism: 1,
      startedAt: new Date(),
      frozenAt: new Date(),
    },
  });
  await prisma.invocation.create({
    data: {
      id: sourceInvocationId,
      planId,
      sequence: 0,
      purpose: "Produce candidate",
      targetKind: "AI_AUTO",
      outputDeclarations: [{ name: "result", artifactType: "TEXT" }],
      acceptanceCriteria: [],
      riskClass: "READ_ONLY",
      approvalPolicy: "AUTO",
      failurePolicy: "FAIL_PLAN",
      joinPolicy: "ALL_REQUIRED",
      status: "COMPLETED",
    },
  });
  await prisma.invocation.create({
    data: {
      id: evaluatorInvocationId,
      planId,
      sequence: 1,
      purpose: "Evaluate candidate",
      targetKind: "EVALUATOR",
      outputDeclarations: [{ name: "evaluation", artifactType: "JSON" }],
      acceptanceCriteria: [input.criterion],
      riskClass: "READ_ONLY",
      approvalPolicy: "AUTO",
      failurePolicy: "FAIL_PLAN",
      joinPolicy: "ALL_REQUIRED",
      status: "RUNNING",
    },
  });
  await prisma.invocationDependency.create({
    data: {
      id: randomUUID(),
      planId,
      fromInvocationId: sourceInvocationId,
      toInvocationId: evaluatorInvocationId,
      conditionKind: "DATA",
      conditionOutcome: "",
      inputBindings: [
        {
          inputName: "result",
          sourceOutputName: "result",
          expectedArtifactType: "TEXT",
        },
      ],
    },
  });

  const artifacts = new ArtifactService(prisma);
  await artifacts.createArtifact({
    actorUserId: userId,
    creatorInvocationId: sourceInvocationId,
    outputName: "result",
    type: "TEXT",
    classification: "PRIVATE",
    content: {
      kind: "INLINE_JSON",
      value: input.artifactValue,
    },
  });

  const run = await prisma.invocationRun.create({
    data: {
      invocationId: evaluatorInvocationId,
      attempt: 1,
      idempotencyKey: `${evaluatorInvocationId}:attempt:1`,
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  return {
    planId,
    userId,
    sourceInvocationId,
    evaluatorInvocationId,
    runId: run.id,
    idempotencyKey: run.idempotencyKey,
  };
}

function executionInput(seeded: SeededEvaluator): InvocationExecutionInput {
  return {
    planId: seeded.planId,
    invocationId: seeded.evaluatorInvocationId,
    attempt: 1,
    runId: seeded.runId,
    idempotencyKey: seeded.idempotencyKey,
    target: {
      kind: "EVALUATOR",
      modelSlug: null,
      agentId: null,
    },
  };
}
