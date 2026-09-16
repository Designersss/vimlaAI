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
