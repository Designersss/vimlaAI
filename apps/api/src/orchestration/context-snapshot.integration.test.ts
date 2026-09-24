import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { loadApiConfig } from "@vimla/config/server";
import { MemoryService } from "@vimla/context";
import { createPrismaClient, type PrismaClient } from "@vimla/database";
import { createVimlaApiApp } from "../create-app.js";
import { registerVerifiedUser } from "../test/identity-helpers.js";
import type { ExecutionPlanDefinition } from "./contracts.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const origin = "http://localhost:3000";

describe("execution plan context snapshot", () => {
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
    process.env.MEMORY_ENABLED = "true";
    process.env.PROJECTS_ENABLED = "true";

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

  it("derives current project from persisted conversation focus and excludes unrelated personal Memory", async () => {
    const owner = await registerVerifiedUser(
      app,
      "context-current-project",
    );
    const project = await prisma.project.create({
      data: {
        ownerUserId: owner.id,
        name: "Current Project",
      },
    });
    const conversation = await prisma.conversation.create({
      data: {
        userId: owner.id,
        projectId: project.id,
        title: "Focused project chat",
        kind: "CHAT",
      },
    });

    const memory = new MemoryService(
      prisma,
      {
        canWriteProject: async ({ actorUserId, projectId }) =>
          actorUserId === owner.id && projectId === project.id,
      },
    );
    const personal = await memory.rememberPersonal({
      actorUserId: owner.id,
      type: "USER_FACT",
      slotKey: "launch region",
      content: "General launch region preference is global",
    });
    const projectMemory = await memory.rememberProject({
      actorUserId: owner.id,
      projectId: project.id,
      type: "PROJECT_FACT",
      slotKey: "launch region",
      content: "Current project launch region is Europe",
    });

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: "What is the launch region?",
        status: "COMPLETE",
      },
    });
    const created = await app.inject({
      method: "POST",
      url: "/v1/execution-plans",
      headers: { origin, "content-type": "application/json" },
      cookies: owner.cookies,
      payload: {
        messageId: message.id,
        plan: simplePlan(),
      },
    });
    expect(created.statusCode).toBe(201);
    const planId = created.json().id as string;
    const snapshot =
      await prisma.contextSnapshot.findUniqueOrThrow({
        where: { planId },
        include: {
          items: { orderBy: { sequence: "asc" } },
        },
      });

    const projectIndex = snapshot.items.findIndex(
      (item) =>
        item.sourceType === "MEMORY" &&
        item.sourceId === projectMemory.id,
    );
    const personalIndex = snapshot.items.findIndex(
      (item) =>
        item.sourceType === "MEMORY" &&
        item.sourceId === personal.id,
    );
    expect(projectIndex).toBeGreaterThanOrEqual(0);
    // Project snapshots are audience-scoped before semantic planning.
    // Unrelated Personal Memory must never enter this immutable snapshot.
    expect(personalIndex).toBe(-1);
    expect(
      snapshot.items[projectIndex]?.metadata,
    ).toMatchObject({
      retrieval: {
        currentProject: true,
        scope: {
          kind: "PROJECT",
          projectId: project.id,
        },
      },
    });
  });

  it("creates the snapshot before start and preserves it across source edits and create replay", async () => {
    const owner = await registerVerifiedUser(app, "context-api");
    await prisma.userPreference.upsert({
      where: { userId: owner.id },
      create: { userId: owner.id, locale: "ru", timezone: "Europe/Moscow" },
      update: { locale: "ru", timezone: "Europe/Moscow" },
    });
    const conversation = await prisma.conversation.create({
      data: { userId: owner.id, title: `Context API ${randomUUID()}` },
    });
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: "Freeze this request",
        status: "COMPLETE",
      },
    });
    const plan = simplePlan();

    const created = await app.inject({
      method: "POST",
      url: "/v1/execution-plans",
      headers: { origin, "content-type": "application/json" },
      cookies: owner.cookies,
      payload: { messageId: message.id, plan },
    });
    expect(created.statusCode).toBe(201);
    const planId = created.json().id as string;

    const snapshot = await prisma.contextSnapshot.findUnique({
      where: { planId },
      include: { items: { orderBy: { sequence: "asc" } } },
    });
    expect(snapshot).not.toBeNull();
    const frozenFingerprint = snapshot?.fingerprint;
    const frozenMessage = snapshot?.items.find((item) => item.sourceType === "USER_MESSAGE");
    expect(frozenMessage?.metadata).toMatchObject({ content: "Freeze this request" });

    await prisma.message.update({
      where: { id: message.id },
      data: { content: "Edited after the snapshot" },
    });

    const replay = await app.inject({
      method: "POST",
      url: "/v1/execution-plans",
      headers: { origin, "content-type": "application/json" },
      cookies: owner.cookies,
      payload: { messageId: message.id, plan },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(planId);

    const retained = await prisma.contextSnapshot.findUnique({
      where: { planId },
      include: { items: { orderBy: { sequence: "asc" } } },
    });
    expect(retained?.fingerprint).toBe(frozenFingerprint);
    expect(retained?.items.find((item) => item.sourceType === "USER_MESSAGE")?.metadata).toMatchObject({
      content: "Freeze this request",
    });

    const started = await app.inject({
      method: "POST",
      url: `/v1/execution-plans/${planId}/start`,
      headers: { origin, "content-type": "application/json" },
      cookies: owner.cookies,
      payload: {},
    });
    expect(started.statusCode).toBe(200);
    expect(started.json().status).toBe("RUNNING");
  });
});

function simplePlan(): ExecutionPlanDefinition {
  return {
    schemaVersion: 1,
    goal: "Read frozen context",
    maxParallelism: 1,
    invocations: [
      {
        id: "read-context",
        purpose: "Read the immutable context snapshot",
        target: { kind: "VIMLA" },
        outputs: [],
        acceptanceCriteria: [],
        riskClass: "READ_ONLY",
        approvalPolicy: "AUTO",
        failurePolicy: "FAIL_PLAN",
        joinPolicy: "ALL_REQUIRED",
      },
    ],
    dependencies: [],
  };
}
