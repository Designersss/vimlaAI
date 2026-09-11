import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { seedVimlaAiModels } from "@vimla/ai";
import { seedVimlaPlans } from "@vimla/billing";
import { loadApiConfig } from "@vimla/config/server";
import { createPrismaClient } from "@vimla/database";
import { createVimlaApiApp } from "../create-app.js";
import { registerVerifiedUser } from "../test/identity-helpers.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const origin = "http://localhost:3000";

describe("operator concurrency", () => {
  let app: NestFastifyApplication;

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
    process.env.AI_TEXT_ENABLED = "true";
    process.env.AI_TEXT_PROVIDER = "mock";
    process.env.OPERATOR_ENABLED = "true";

    const prisma = createPrismaClient(testDatabaseUrl);
    await seedVimlaPlans(prisma);
    await seedVimlaAiModels(prisma);
    await prisma.$disconnect();

    const config = loadApiConfig(process.env);
    app = await createVimlaApiApp(config, { quiet: true });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("commits one user message and one tool side effect for concurrent request replay", async () => {
    const user = await readyUser(app, "op-race-create");
    const clientRequestId = randomUUID();
    const content = "@Vimla создай задачу купить билеты завтра";
    const request = () =>
      app.inject({
        method: "POST",
        url: "/v1/operator/runs",
        headers: jsonHeaders(),
        cookies: user.cookies,
        payload: { clientRequestId, content },
      });

    const [left, right] = await Promise.all([request(), request()]);
    expect(left.statusCode).toBe(201);
    expect(right.statusCode).toBe(201);
    expect(left.json().id).toBe(right.json().id);

    const prisma = createPrismaClient(testDatabaseUrl);
    try {
      const run = await prisma.operatorRun.findUniqueOrThrow({
        where: { userId_clientRequestId: { userId: user.id, clientRequestId } },
      });
      const userMessages = await prisma.message.count({
        where: { conversationId: run.conversationId, role: "USER", content },
      });
      const taskEffects = await prisma.operatorAuditEvent.count({
        where: { runId: run.id, toolName: "tasks.create", result: "ok" },
      });
      expect(userMessages).toBe(1);
      expect(taskEffects).toBe(1);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("executes a confirmed destructive step only once under concurrent confirmation", async () => {
    const user = await readyUser(app, "op-race-confirm");
    const task = await app.inject({
      method: "POST",
      url: "/v1/workspace/tasks",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { title: "Concurrent delete target" },
    });
    expect(task.statusCode).toBe(201);
    const taskId = task.json().id as string;

    const run = await app.inject({
      method: "POST",
      url: "/v1/operator/runs",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { clientRequestId: randomUUID(), content: `@Vimla удали задачу ${taskId}` },
    });
    expect(run.statusCode).toBe(201);
    expect(run.json().status).toBe("AWAITING_CONFIRMATION");
    const runId = run.json().id as string;
    const confirmationToken = run.json().confirmationToken as string;

    const confirm = () =>
      app.inject({
        method: "POST",
        url: `/v1/operator/runs/${runId}/confirm`,
        headers: jsonHeaders(),
        cookies: user.cookies,
        payload: { confirmationToken },
      });
    const [left, right] = await Promise.all([confirm(), confirm()]);
    expect(left.statusCode).toBe(200);
    expect(right.statusCode).toBe(200);

    const prisma = createPrismaClient(testDatabaseUrl);
    try {
      const successfulDeletes = await prisma.operatorAuditEvent.count({
        where: { runId, toolName: "tasks.delete", result: "ok" },
      });
      const stored = await prisma.workspaceObject.findUnique({ where: { id: taskId } });
      expect(successfulDeletes).toBe(1);
      expect(stored?.deletedAt).not.toBeNull();
    } finally {
      await prisma.$disconnect();
    }
  });
});

async function readyUser(app: NestFastifyApplication, label: string) {
  const user = await registerVerifiedUser(app, label);
  const purchased = await app.inject({
    method: "POST",
    url: "/dev/mock-purchases/subscription",
    headers: jsonHeaders(),
    cookies: user.cookies,
    payload: { planCode: "PRO" },
  });
  expect(purchased.statusCode).toBe(201);
  const tz = await app.inject({
    method: "PATCH",
    url: "/v1/me/preferences",
    headers: jsonHeaders(),
    cookies: user.cookies,
    payload: { timezone: "Europe/Moscow" },
  });
  expect(tz.statusCode).toBe(200);
  return user;
}

function jsonHeaders(): Record<string, string> {
  return { origin, "content-type": "application/json" };
}
