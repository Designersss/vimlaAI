import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { loadApiConfig } from "@vimla/config/server";
import { createPrismaClient, type PrismaClient } from "@vimla/database";
import { createVimlaApiApp } from "../create-app.js";
import { registerVerifiedUser } from "../test/identity-helpers.js";
import type { ExecutionPlanDefinition } from "./contracts.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const origin = "http://localhost:3000";

describe("execution plan API", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "test";
    process.env.LOG_LEVEL = "error";
    process.env.API_HOST = "127.0.0.1";
    process.env.API_PORT = "3001";
    process.env.WEB_ORIGIN = origin;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET ?? "local-dev-only-change-me-use-32-chars-min";
    process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
    process.env.OPERATOR_ENABLED = "true";

    prisma = createPrismaClient(testDatabaseUrl);
    const config = loadApiConfig(process.env);
    app = await createVimlaApiApp(config, { quiet: true });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });

  it("requires authentication, rejects authority injection and rejects an invalid graph", async () => {
    const anonymous = await app.inject({
      method: "POST",
      url: "/v1/execution-plans",
      headers: jsonHeaders(),
      payload: { messageId: "missing", plan: sequentialPlan() },
    });
    expect(anonymous.statusCode).toBe(401);

    const user = await registerVerifiedUser(app, "orchestration-validation");
    const messageId = await createSourceMessage(user.id);

    const injected = await app.inject({
      method: "POST",
      url: "/v1/execution-plans",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: {
        messageId,
        userId: "attacker-controlled",
        plan: sequentialPlan(),
      },
    });
    expect(injected.statusCode).toBe(400);

    const cyclic = sequentialPlan();
    cyclic.dependencies.push({
      id: "image-back-to-prompt",
      fromInvocationId: "image",
      toInvocationId: "prompt",
      condition: { kind: "ON_SUCCESS" },
      inputBindings: [],
    });
    const rejected = await app.inject({
      method: "POST",
      url: "/v1/execution-plans",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { messageId, plan: cyclic },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe("validation_error");
  });

  it("persists a manual graph exactly, is replay-safe, owner-scoped and freezes on start", async () => {
    const owner = await registerVerifiedUser(app, "orchestration-owner");
    const stranger = await registerVerifiedUser(app, "orchestration-stranger");
    const messageId = await createSourceMessage(owner.id);
    const plan = sequentialPlan();

    const created = await app.inject({
      method: "POST",
      url: "/v1/execution-plans",
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { messageId, plan },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().status).toBe("PLANNED");
    expect(created.json().invocations.map((item: { id: string }) => item.id)).toEqual([
      "prompt",
      "image",
    ]);
    expect(created.json().dependencies).toEqual(plan.dependencies);
    expect(created.json().invocations.every((item: { status: string }) => item.status === "PENDING")).toBe(true);
    expect(JSON.stringify(created.json())).not.toContain(owner.id);
    const planId = created.json().id as string;

    const replay = await app.inject({
      method: "POST",
      url: "/v1/execution-plans",
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { messageId, plan },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(planId);
    expect(replay.json().planHash).toBe(created.json().planHash);

    const conflictingPlan = sequentialPlan();
    conflictingPlan.goal = "A different immutable plan";
    const conflict = await app.inject({
      method: "POST",
      url: "/v1/execution-plans",
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { messageId, plan: conflictingPlan },
    });
    expect(conflict.statusCode).toBe(409);

    const stolen = await app.inject({
      method: "GET",
      url: `/v1/execution-plans/${planId}`,
      headers: { origin },
      cookies: stranger.cookies,
    });
    expect(stolen.statusCode).toBe(404);

    const started = await app.inject({
      method: "POST",
      url: `/v1/execution-plans/${planId}/start`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: {},
    });
    expect(started.statusCode).toBe(200);
    expect(started.json().status).toBe("RUNNING");
    expect(started.json().frozenAt).toEqual(expect.any(String));
    expect(statusById(started.json())).toEqual({ prompt: "READY", image: "PENDING" });

    const startReplay = await app.inject({
      method: "POST",
      url: `/v1/execution-plans/${planId}/start`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: {},
    });
    expect(startReplay.statusCode).toBe(200);
    expect(startReplay.json().startedAt).toBe(started.json().startedAt);

    const stopped = await app.inject({
      method: "POST",
      url: `/v1/execution-plans/${planId}/stop`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: {},
    });
    expect(stopped.statusCode).toBe(200);
    expect(stopped.json().status).toBe("CANCELED");
    expect(statusById(stopped.json())).toEqual({ prompt: "CANCELED", image: "CANCELED" });

    const stopReplay = await app.inject({
      method: "POST",
      url: `/v1/execution-plans/${planId}/stop`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: {},
    });
    expect(stopReplay.statusCode).toBe(200);
    expect(stopReplay.json().id).toBe(planId);
  });

  it("exposes an owner-scoped workflow UI read model by source message", async () => {
    const owner = await registerVerifiedUser(app, "orchestration-ui-owner");
    const stranger = await registerVerifiedUser(app, "orchestration-ui-stranger");
    const messageId = await createSourceMessage(owner.id);

    const created = await app.inject({
      method: "POST",
      url: "/v1/execution-plans",
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { messageId, plan: sequentialPlan() },
    });
    expect(created.statusCode).toBe(201);
    const planId = created.json().id as string;

    const promptInvocation = await prisma.invocation.findFirstOrThrow({
      where: { planId, sequence: 0 },
      select: { id: true },
    });
    const run = await prisma.invocationRun.create({
      data: {
        invocationId: promptInvocation.id,
        attempt: 2,
        idempotencyKey: `ui-read-model:${randomUUID()}`,
        status: "FAILED",
        outcome: null,
        errorCode: "AI_PROVIDER_INTERRUPTED",
        startedAt: new Date("2026-09-21T08:00:00.000Z"),
        finishedAt: new Date("2026-09-21T08:00:01.000Z"),
      },
    });
    const artifact = await prisma.artifact.create({
      data: {
        creatorInvocationId: promptInvocation.id,
        outputName: "prompt",
        type: "PROMPT",
        classification: "PRIVATE",
        metadata: { internal: "must-not-leak" },
        versions: {
          create: {
            version: 1,
            contentJson: { secretPayload: "not-for-plan-view" },
            fingerprint: "sha256:test-workflow-ui-v1",
            metadata: { internalVersion: true },
            createdAt: new Date("2026-09-21T08:00:01.000Z"),
          },
        },
      },
      include: { versions: true },
    });
    const version1 = artifact.versions[0];
    if (!version1) throw new Error("Expected artifact version");
    const version = await prisma.artifactVersion.create({
      data: {
        artifactId: artifact.id,
        version: 2,
        contentJson: { secretPayload: "latest-still-not-for-plan-view" },
        fingerprint: "sha256:test-workflow-ui-v2",
        metadata: { internalVersion: "latest" },
        createdAt: new Date("2026-09-21T08:00:02.000Z"),
      },
    });

    const lookup = await app.inject({
      method: "GET",
      url: `/v1/execution-plans/by-message/${messageId}`,
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().plan.id).toBe(planId);
    const prompt = lookup
      .json()
      .plan.invocations.find((item: { id: string }) => item.id === "prompt");
    expect(prompt).toMatchObject({
      status: "PENDING",
      requiresApproval: false,
      latestRun: {
        id: run.id,
        attempt: 2,
        status: "FAILED",
        outcome: null,
        errorCode: "AI_PROVIDER_INTERRUPTED",
        startedAt: "2026-09-21T08:00:00.000Z",
        finishedAt: "2026-09-21T08:00:01.000Z",
      },
      artifacts: [
        {
          artifactId: artifact.id,
          artifactVersionId: version.id,
          outputName: "prompt",
          type: "PROMPT",
          classification: "PRIVATE",
          version: 2,
          createdAt: "2026-09-21T08:00:02.000Z",
        },
      ],
    });
    expect(JSON.stringify(prompt)).not.toContain("secretPayload");
    expect(JSON.stringify(prompt)).not.toContain("contentJson");
    expect(JSON.stringify(prompt)).not.toContain("contentRef");
    expect(JSON.stringify(prompt)).not.toContain("fingerprint");
    expect(JSON.stringify(prompt)).not.toContain("must-not-leak");

    const conversationPlans = await app.inject({
      method: "GET",
      url: `/v1/execution-plans/by-conversation/${created.json().conversationId}`,
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(conversationPlans.statusCode).toBe(200);
    expect(conversationPlans.json().plans).toHaveLength(1);
    expect(conversationPlans.json().plans[0].id).toBe(planId);
    expect(conversationPlans.json().plans[0].invocations[0].latestRun.id).toBe(
      run.id,
    );

    const foreignConversationPlans = await app.inject({
      method: "GET",
      url: `/v1/execution-plans/by-conversation/${created.json().conversationId}`,
      headers: { origin },
      cookies: stranger.cookies,
    });
    expect(foreignConversationPlans.statusCode).toBe(200);
    expect(foreignConversationPlans.json()).toEqual({ plans: [] });

    const noPlanMessageId = await createSourceMessage(owner.id);
    const noPlan = await app.inject({
      method: "GET",
      url: `/v1/execution-plans/by-message/${noPlanMessageId}`,
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(noPlan.statusCode).toBe(200);
    expect(noPlan.json()).toEqual({ plan: null });

    const foreignLookup = await app.inject({
      method: "GET",
      url: `/v1/execution-plans/by-message/${messageId}`,
      headers: { origin },
      cookies: stranger.cookies,
    });
    expect(foreignLookup.statusCode).toBe(200);
    expect(foreignLookup.json()).toEqual({ plan: null });
  });

  it("bounds conversation polling to active plans or the latest terminal plan", async () => {
    const owner = await registerVerifiedUser(app, "orchestration-ui-bounded");
    const conversation = await prisma.conversation.create({
      data: {
        userId: owner.id,
        title: "Workflow polling bounds",
      },
    });
    const firstMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: "First workflow",
        status: "COMPLETE",
      },
    });
    const secondMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: "Second workflow",
        status: "COMPLETE",
      },
    });

    const firstCreated = await app.inject({
      method: "POST",
      url: "/v1/execution-plans",
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { messageId: firstMessage.id, plan: approvalPlan() },
    });
    const secondCreated = await app.inject({
      method: "POST",
      url: "/v1/execution-plans",
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { messageId: secondMessage.id, plan: approvalPlan() },
    });
    expect(firstCreated.statusCode).toBe(201);
    expect(secondCreated.statusCode).toBe(201);

    const firstPlanId = firstCreated.json().id as string;
    const secondPlanId = secondCreated.json().id as string;
    await prisma.executionPlan.update({
      where: { id: firstPlanId },
      data: {
        status: "COMPLETED",
        completedAt: new Date("2026-09-21T08:00:01.000Z"),
        createdAt: new Date("2026-09-21T08:00:00.000Z"),
      },
    });
    await prisma.executionPlan.update({
      where: { id: secondPlanId },
      data: {
        status: "RUNNING",
        startedAt: new Date("2026-09-21T08:01:00.000Z"),
        createdAt: new Date("2026-09-21T08:01:00.000Z"),
      },
    });

    const activeOnly = await app.inject({
      method: "GET",
      url: `/v1/execution-plans/by-conversation/${conversation.id}`,
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(activeOnly.statusCode).toBe(200);
    expect(activeOnly.json().plans.map((plan: { id: string }) => plan.id)).toEqual([
      secondPlanId,
    ]);

    await prisma.executionPlan.update({
      where: { id: secondPlanId },
      data: {
        status: "CANCELED",
        completedAt: new Date("2026-09-21T08:02:00.000Z"),
      },
    });

    const latestTerminalOnly = await app.inject({
      method: "GET",
      url: `/v1/execution-plans/by-conversation/${conversation.id}`,
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(latestTerminalOnly.statusCode).toBe(200);
    expect(
      latestTerminalOnly.json().plans.map((plan: { id: string }) => plan.id),
    ).toEqual([secondPlanId]);
  });

  it("rejects high-risk invocations that try to bypass explicit approval", async () => {
    const owner = await registerVerifiedUser(app, "orchestration-risk-approval");
    const messageId = await createSourceMessage(owner.id);
    const plan = approvalPlan();
    const invocation = plan.invocations[0];
    if (!invocation) throw new Error("Expected approval-plan invocation");
    plan.invocations[0] = {
      ...invocation,
      riskClass: "FINANCIAL",
      approvalPolicy: "AUTO",
    };

    const response = await app.inject({
      method: "POST",
      url: "/v1/execution-plans",
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { messageId, plan },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_error");
    expect(
      await prisma.executionPlan.count({ where: { messageId } }),
    ).toBe(0);
  });

  it("supports explicit approval without executing the invocation", async () => {
    const owner = await registerVerifiedUser(app, "orchestration-approval");
    const messageId = await createSourceMessage(owner.id);
    const plan = approvalPlan();

    const created = await app.inject({
      method: "POST",
      url: "/v1/execution-plans",
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { messageId, plan },
    });
    expect(created.statusCode).toBe(201);
    const planId = created.json().id as string;

    const started = await app.inject({
      method: "POST",
      url: `/v1/execution-plans/${planId}/start`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: {},
    });
    expect(started.statusCode).toBe(200);
    expect(statusById(started.json())).toEqual({ remind: "WAITING_APPROVAL" });

    const approved = await app.inject({
      method: "POST",
      url: `/v1/execution-plans/${planId}/approve`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { invocationId: "remind" },
    });
    expect(approved.statusCode).toBe(200);
    expect(statusById(approved.json())).toEqual({ remind: "READY" });

    const approvalReplay = await app.inject({
      method: "POST",
      url: `/v1/execution-plans/${planId}/approve`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { invocationId: "remind" },
    });
    expect(approvalReplay.statusCode).toBe(200);
    expect(statusById(approvalReplay.json())).toEqual({ remind: "READY" });

    const runs = await prisma.invocationRun.count({
      where: { invocation: { planId } },
    });
    expect(runs).toBe(0);
  });

  it("resolves HUMAN_APPROVAL evaluators through a dedicated idempotent decision endpoint", async () => {
    const owner = await registerVerifiedUser(
      app,
      "orchestration-human-evaluator",
    );
    const messageId = await createSourceMessage(owner.id);

    const created = await app.inject({
      method: "POST",
      url: "/v1/execution-plans",
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { messageId, plan: humanEvaluationPlan() },
    });
    expect(created.statusCode).toBe(201);
    const planId = created.json().id as string;

    const started = await app.inject({
      method: "POST",
      url: `/v1/execution-plans/${planId}/start`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: {},
    });
    expect(started.statusCode).toBe(200);
    expect(statusById(started.json())).toEqual({
      review: "WAITING_APPROVAL",
    });

    const genericApprove = await app.inject({
      method: "POST",
      url: `/v1/execution-plans/${planId}/approve`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { invocationId: "review" },
    });
    expect(genericApprove.statusCode).toBe(409);

    const resolved = await app.inject({
      method: "POST",
      url: `/v1/execution-plans/${planId}/evaluations/review/resolve`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: {
        outcome: "FAIL",
        summary: "The generated image does not match the agreed direction.",
      },
    });
    expect(resolved.statusCode).toBe(200);
    expect(statusById(resolved.json())).toEqual({
      review: "COMPLETED",
    });
    const review = resolved
      .json()
      .invocations.find((item: { id: string }) => item.id === "review");
    expect(review.latestRun).toMatchObject({
      status: "COMPLETED",
      outcome: "FAIL",
      evaluation: {
        mode: "HUMAN_APPROVAL",
        outcome: "FAIL",
        confidence: 1,
        summary: "The generated image does not match the agreed direction.",
      },
    });
    expect(review.artifacts).toHaveLength(1);
    expect(review.artifacts[0]).toMatchObject({
      outputName: "evaluation",
      type: "JSON",
      version: 1,
    });

    await prisma.executionPlan.update({
      where: { id: planId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    const replay = await app.inject({
      method: "POST",
      url: `/v1/execution-plans/${planId}/evaluations/review/resolve`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: {
        outcome: "FAIL",
        summary: "The generated image does not match the agreed direction.",
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().status).toBe("COMPLETED");
    expect(replay.json().invocations[0].latestRun.id).toBe(
      review.latestRun.id,
    );

    const conflictingReplay = await app.inject({
      method: "POST",
      url: `/v1/execution-plans/${planId}/evaluations/review/resolve`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: {
        outcome: "PASS",
        summary: "Changed my mind.",
      },
    });
    expect(conflictingReplay.statusCode).toBe(409);

    expect(
      await prisma.evaluation.count({
        where: {
          invocationRun: {
            invocation: { planId },
          },
        },
      }),
    ).toBe(1);
  });

  async function createSourceMessage(userId: string): Promise<string> {
    const conversation = await prisma.conversation.create({
      data: {
        userId,
        title: `Manual orchestration ${randomUUID()}`,
      },
    });
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: "Run this manually supplied execution plan",
        status: "COMPLETE",
      },
    });
    return message.id;
  }
});

function sequentialPlan(): ExecutionPlanDefinition {
  return {
    schemaVersion: 1,
    goal: "Create a prompt, then use the prompt artifact to create an image",
    maxParallelism: 2,
    invocations: [
      {
        id: "prompt",
        purpose: "Create an image prompt",
        target: { kind: "AI_MODEL", modelSlug: "gpt" },
        outputs: [{ name: "prompt", artifactType: "PROMPT" }],
        acceptanceCriteria: [],
        riskClass: "READ_ONLY",
        approvalPolicy: "AUTO",
        failurePolicy: "FAIL_PLAN",
        joinPolicy: "ALL_REQUIRED",
      },
      {
        id: "image",
        purpose: "Create an image from the prompt",
        target: { kind: "AI_MODEL", modelSlug: "image-model" },
        outputs: [{ name: "image", artifactType: "IMAGE" }],
        acceptanceCriteria: [],
        riskClass: "READ_ONLY",
        approvalPolicy: "AUTO",
        failurePolicy: "FAIL_PLAN",
        joinPolicy: "ALL_REQUIRED",
      },
    ],
    dependencies: [
      {
        id: "prompt-to-image",
        fromInvocationId: "prompt",
        toInvocationId: "image",
        condition: { kind: "DATA" },
        inputBindings: [
          {
            inputName: "prompt",
            sourceOutputName: "prompt",
            expectedArtifactType: "PROMPT",
          },
        ],
      },
    ],
  };
}

function humanEvaluationPlan(): ExecutionPlanDefinition {
  return {
    schemaVersion: 1,
    goal: "Ask the human to evaluate the generated result",
    maxParallelism: 1,
    invocations: [
      {
        id: "review",
        purpose: "Review the generated result",
        target: { kind: "EVALUATOR" },
        outputs: [{ name: "evaluation", artifactType: "JSON" }],
        acceptanceCriteria: [
          {
            id: "human-review",
            description: "Human reviewer accepts the result",
            mode: "HUMAN_APPROVAL",
          },
        ],
        riskClass: "READ_ONLY",
        approvalPolicy: "HUMAN_APPROVAL",
        failurePolicy: "FAIL_PLAN",
        joinPolicy: "ALL_REQUIRED",
      },
    ],
    dependencies: [],
  };
}

function approvalPlan(): ExecutionPlanDefinition {
  return {
    schemaVersion: 1,
    goal: "Prepare a Vimla reminder but require explicit approval",
    maxParallelism: 1,
    invocations: [
      {
        id: "remind",
        purpose: "Create a reminder",
        target: { kind: "VIMLA" },
        outputs: [],
        acceptanceCriteria: [],
        riskClass: "INTERNAL_WRITE",
        approvalPolicy: "USER_CONFIRMATION",
        failurePolicy: "FAIL_PLAN",
        joinPolicy: "ALL_REQUIRED",
      },
    ],
    dependencies: [],
  };
}

function jsonHeaders(): Record<string, string> {
  return { origin, "content-type": "application/json" };
}

function statusById(body: {
  invocations: Array<{ id: string; status: string }>;
}): Record<string, string> {
  return Object.fromEntries(body.invocations.map((invocation) => [invocation.id, invocation.status]));
}
