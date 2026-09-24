import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { loadApiConfig } from "@vimla/config/server";
import { createPrismaClient } from "@vimla/database";
import { createVimlaApiApp } from "../create-app.js";
import { registerVerifiedUser } from "../test/identity-helpers.js";
import { ChatMentionRoutingService } from "./chat-mention-routing.service.js";
import { OrchestrationService } from "../orchestration/orchestration.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for structured mention integration tests");
}

const origin = "http://localhost:3000";

describe("structured normal-chat mention routing", () => {
  let app: NestFastifyApplication;
  let routing: ChatMentionRoutingService;
  let orchestration: OrchestrationService;
  const prisma = createPrismaClient(testDatabaseUrl);

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
    process.env.AI_MAX_MESSAGE_BYTES = "1024";
    process.env.AI_TEXT_PROVIDER = "mock";
    process.env.OPERATOR_ENABLED = "true";

    app = await createVimlaApiApp(loadApiConfig(process.env), { quiet: true });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    routing = app.get(ChatMentionRoutingService);
    orchestration = app.get(OrchestrationService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (app) await app.close();
  });

  it("does not let plaintext @vimla forge system routing", async () => {
    const user = await registerVerifiedUser(app, "structured-plain");
    const resolved = await routing.resolve({
      userId: user.id,
      content: "@vimla do this",
      mentions: [],
    });

    expect(resolved).toEqual([]);
    expect(routing.routeFor(resolved)).toBe("CHAT");
  });

  it("keeps the parent AI thread target unchanged after a temporary @vimla workflow override", async () => {
    const user = await registerVerifiedUser(app, "thread-vimla-override");
    const model = await prisma.aiModel.findFirstOrThrow({
      where: {
        active: true,
        visible: true,
        slug: "claude-haiku-4-5",
      },
    });
    const conversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        title: "Claude-like thread",
        defaultTargetKind: "AI_MODEL",
        defaultTargetModelId: model.id,
      },
    });
    const vimla = await prisma.handle.findUniqueOrThrow({
      where: { normalized: "vimla" },
    });

    const routed = await routing.persist({
      userId: user.id,
      conversationId: conversation.id,
      clientRequestId: crypto.randomUUID(),
      content: "@vimla do this once",
      mentions: [
        {
          handleId: vimla.id,
          kind: "SYSTEM_AGENT",
          canonicalHandle: "vimla",
          startOffset: 0,
          endOffset: 6,
        },
      ],
    });
    expect(routed.route).toBe("ORCHESTRATION");

    await orchestration.planMessage(
      user.id,
      routed.messageId,
      routed.mentions,
      crypto.randomUUID(),
    );

    const after = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(after.defaultTargetKind).toBe("AI_MODEL");
    expect(after.defaultTargetModelId).toBe(model.id);
  });

  it("routes a validated selected @vimla mention into orchestration", async () => {
    const user = await registerVerifiedUser(app, "structured-vimla");
    const conversation = await prisma.conversation.create({ data: { userId: user.id, title: "Routing" } });
    const vimla = await prisma.handle.findUniqueOrThrow({ where: { normalized: "vimla" } });

    const result = await routing.persist({
      userId: user.id,
      conversationId: conversation.id,
      clientRequestId: crypto.randomUUID(),
      content: "@vimla do this",
      mentions: [
        {
          handleId: vimla.id,
          kind: "SYSTEM_AGENT",
          canonicalHandle: "vimla",
          startOffset: 0,
          endOffset: 6,
        },
      ],
    });

    expect(result.route).toBe("ORCHESTRATION");
    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]?.targetId).toBe("VIMLA");

    const persisted = await prisma.messageMention.findMany({ where: { messageId: result.messageId } });
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.canonicalHandle).toBe("vimla");
  });

  it("persists repeated @auto occurrences distinctly", async () => {
    const user = await registerVerifiedUser(app, "structured-auto");
    const conversation = await prisma.conversation.create({ data: { userId: user.id, title: "Auto" } });
    const auto = await prisma.handle.findUniqueOrThrow({ where: { normalized: "auto" } });
    const content = "@auto draft for @auto";

    const result = await routing.persist({
      userId: user.id,
      conversationId: conversation.id,
      clientRequestId: crypto.randomUUID(),
      content,
      mentions: [
        {
          handleId: auto.id,
          kind: "AI_AUTO",
          canonicalHandle: "auto",
          startOffset: 0,
          endOffset: 5,
        },
        {
          handleId: auto.id,
          kind: "AI_AUTO",
          canonicalHandle: "auto",
          startOffset: 16,
          endOffset: 21,
        },
      ],
    });

    expect(result.route).toBe("ORCHESTRATION");
    expect(result.mentions.map((mention) => [mention.startOffset, mention.endOffset])).toEqual([
      [0, 5],
      [16, 21],
    ]);
    expect(new Set(result.mentions.map((mention) => mention.id)).size).toBe(2);
  });

  it("replays the same workflow submission but rejects a changed payload for the same clientRequestId", async () => {
    const user = await registerVerifiedUser(app, "structured-idempotency");
    const conversation = await prisma.conversation.create({
      data: { userId: user.id, title: "Idempotency" },
    });
    const auto = await prisma.handle.findUniqueOrThrow({
      where: { normalized: "auto" },
    });
    const clientRequestId = crypto.randomUUID();
    const mention = {
      handleId: auto.id,
      kind: "AI_AUTO" as const,
      canonicalHandle: "auto",
      startOffset: 0,
      endOffset: 5,
    };

    const first = await routing.persist({
      userId: user.id,
      conversationId: conversation.id,
      clientRequestId,
      content: "@auto first request",
      mentions: [mention],
    });
    const replay = await routing.persist({
      userId: user.id,
      conversationId: conversation.id,
      clientRequestId,
      content: "@auto first request",
      mentions: [mention],
    });
    expect(replay.messageId).toBe(first.messageId);

    await expect(
      routing.persist({
        userId: user.id,
        conversationId: conversation.id,
        clientRequestId,
        content: "@auto changed request",
        mentions: [mention],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects oversized orchestration messages before persistence", async () => {
    const user = await registerVerifiedUser(app, "structured-size-limit");
    const conversation = await prisma.conversation.create({
      data: { userId: user.id, title: "Size limit" },
    });
    const auto = await prisma.handle.findUniqueOrThrow({
      where: { normalized: "auto" },
    });
    const clientRequestId = crypto.randomUUID();
    const content = `@auto ${"x".repeat(2_000)}`;

    const response = await app.inject({
      method: "POST",
      url: `/v1/conversations/${conversation.id}/messages`,
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: {
        clientRequestId,
        modelId: "unused-for-orchestration",
        content,
        mentions: [
          {
            handleId: auto.id,
            kind: "AI_AUTO",
            canonicalHandle: "auto",
            startOffset: 0,
            endOffset: 5,
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(
      await prisma.chatMessageSubmission.count({
        where: { userId: user.id, clientRequestId },
      }),
    ).toBe(0);
  });

  it("compiles a routed structured mention into one durable replay-safe execution plan", async () => {
    const user = await registerVerifiedUser(app, "semantic-plan-auto");
    const conversation = await prisma.conversation.create({
      data: { userId: user.id, title: "Semantic planner" },
    });
    const auto = await prisma.handle.findUniqueOrThrow({
      where: { normalized: "auto" },
    });
    const content = "@auto prepare an independent analysis";

    const routed = await routing.persist({
      userId: user.id,
      conversationId: conversation.id,
      clientRequestId: crypto.randomUUID(),
      content,
      mentions: [
        {
          handleId: auto.id,
          kind: "AI_AUTO",
          canonicalHandle: "auto",
          startOffset: 0,
          endOffset: 5,
        },
      ],
    });

    let planningPlanId: string | null = null;
    const planned = await orchestration.planMessage(
      user.id,
      routed.messageId,
      routed.mentions,
      crypto.randomUUID(),
      (planId) => {
        planningPlanId = planId;
      },
    );
    expect(planned.kind).toBe("PLANNED");
    if (planned.kind !== "PLANNED") {
      throw new Error("Expected a planned workflow");
    }
    expect(planningPlanId).toBe(planned.plan.id);
    expect(planned.plan.status).toBe("PLANNED");
    expect(planned.plan.messageId).toBe(routed.messageId);
    expect(planned.plan.invocations).toHaveLength(1);
    expect(planned.plan.invocations[0]?.target).toEqual({ kind: "AI_AUTO" });

    const replay = await orchestration.planMessage(
      user.id,
      routed.messageId,
      routed.mentions,
      crypto.randomUUID(),
    );
    expect(replay.kind).toBe("PLANNED");
    if (replay.kind !== "PLANNED") {
      throw new Error("Expected a replayed workflow");
    }
    expect(replay.plan.id).toBe(planned.plan.id);
    expect(
      await prisma.executionPlan.count({
        where: { messageId: routed.messageId, userId: user.id },
      }),
    ).toBe(1);
    expect(
      await prisma.contextSnapshot.count({
        where: { planId: planned.plan.id },
      }),
    ).toBe(1);

    await prisma.executionPlan.update({
      where: { id: planned.plan.id },
      data: { status: "CANCELED", completedAt: new Date() },
    });
    const terminalReplay = await orchestration.planMessage(
      user.id,
      routed.messageId,
      routed.mentions,
      crypto.randomUUID(),
    );
    expect(terminalReplay.kind).toBe("EXISTING_PLAN");
    if (terminalReplay.kind !== "EXISTING_PLAN") {
      throw new Error("Expected existing terminal workflow state");
    }
    expect(terminalReplay.plan.status).toBe("CANCELED");
  });

  it("persists clarification on the planning shell and replays it without a second plan", async () => {
    const user = await registerVerifiedUser(app, "semantic-plan-clarify");
    const conversation = await prisma.conversation.create({
      data: { userId: user.id, title: "Clarification" },
    });
    const auto = await prisma.handle.findUniqueOrThrow({
      where: { normalized: "auto" },
    });
    const vimla = await prisma.handle.findUniqueOrThrow({
      where: { normalized: "vimla" },
    });
    const content = "@auto x @vimla";

    const routed = await routing.persist({
      userId: user.id,
      conversationId: conversation.id,
      clientRequestId: crypto.randomUUID(),
      content,
      mentions: [
        {
          handleId: auto.id,
          kind: "AI_AUTO",
          canonicalHandle: "auto",
          startOffset: 0,
          endOffset: 5,
        },
        {
          handleId: vimla.id,
          kind: "SYSTEM_AGENT",
          canonicalHandle: "vimla",
          startOffset: 8,
          endOffset: 14,
        },
      ],
    });

    const first = await orchestration.planMessage(
      user.id,
      routed.messageId,
      routed.mentions,
      crypto.randomUUID(),
    );
    expect(first.kind).toBe("CLARIFICATION_REQUIRED");
    if (first.kind !== "CLARIFICATION_REQUIRED") {
      throw new Error("Expected clarification");
    }

    const shell = await prisma.executionPlan.findUniqueOrThrow({
      where: { messageId: routed.messageId },
      include: { invocations: true, contextSnapshot: true },
    });
    expect(shell.status).toBe("NEEDS_CLARIFICATION");
    expect(shell.planHash).toMatch(/^clarification:/);
    expect(shell.invocations).toHaveLength(0);
    expect(shell.contextSnapshot).not.toBeNull();

    const conversationView = await app.inject({
      method: "GET",
      url: `/v1/execution-plans/by-conversation/${conversation.id}`,
      headers: { origin },
      cookies: user.cookies,
    });
    expect(conversationView.statusCode).toBe(200);
    expect(conversationView.json().plans).toHaveLength(1);
    expect(conversationView.json().plans[0]).toMatchObject({
      id: shell.id,
      status: "NEEDS_CLARIFICATION",
    });

    const replay = await orchestration.planMessage(
      user.id,
      routed.messageId,
      routed.mentions,
      crypto.randomUUID(),
    );
    expect(replay).toEqual(first);
    expect(
      await prisma.executionPlan.count({
        where: { messageId: routed.messageId },
      }),
    ).toBe(1);
  });

  it("returns the durable PLANNING shell instead of starting a concurrent planner", async () => {
    const user = await registerVerifiedUser(app, "semantic-plan-concurrent");
    const conversation = await prisma.conversation.create({
      data: { userId: user.id, title: "Concurrent planning" },
    });
    const auto = await prisma.handle.findUniqueOrThrow({
      where: { normalized: "auto" },
    });

    const routed = await routing.persist({
      userId: user.id,
      conversationId: conversation.id,
      clientRequestId: crypto.randomUUID(),
      content: "@auto analyze this",
      mentions: [
        {
          handleId: auto.id,
          kind: "AI_AUTO",
          canonicalHandle: "auto",
          startOffset: 0,
          endOffset: 5,
        },
      ],
    });

    const shell = await prisma.executionPlan.create({
      data: {
        messageId: routed.messageId,
        userId: user.id,
        conversationId: conversation.id,
        schemaVersion: 1,
        version: 1,
        planHash: "planning:claimed:active",
        goal: "Planning workflow",
        status: "PLANNING",
        maxParallelism: 1,
        updatedAt: new Date(Date.now() - 70_000),
      },
    });

    const result = await orchestration.planMessage(
      user.id,
      routed.messageId,
      routed.mentions,
      crypto.randomUUID(),
    );
    expect(result).toEqual({ kind: "PLANNING", planId: shell.id });
    expect(
      await prisma.invocation.count({ where: { planId: shell.id } }),
    ).toBe(0);
  });

  it("persists server-authoritative approval policy for Vimla semantic actions", async () => {
    const user = await registerVerifiedUser(app, "semantic-plan-vimla-policy");
    const conversation = await prisma.conversation.create({
      data: { userId: user.id, title: "Vimla policy" },
    });
    const vimla = await prisma.handle.findUniqueOrThrow({
      where: { normalized: "vimla" },
    });

    const routed = await routing.persist({
      userId: user.id,
      conversationId: conversation.id,
      clientRequestId: crypto.randomUUID(),
      content: "@vimla create a reminder",
      mentions: [
        {
          handleId: vimla.id,
          kind: "SYSTEM_AGENT",
          canonicalHandle: "vimla",
          startOffset: 0,
          endOffset: 6,
        },
      ],
    });

    const result = await orchestration.planMessage(
      user.id,
      routed.messageId,
      routed.mentions,
      crypto.randomUUID(),
    );
    expect(result.kind).toBe("PLANNED");
    if (result.kind !== "PLANNED") {
      throw new Error("Expected planned Vimla workflow");
    }
    expect(result.plan.invocations[0]).toMatchObject({
      target: { kind: "VIMLA" },
      riskClass: "INTERNAL_WRITE",
      approvalPolicy: "USER_CONFIRMATION",
    });
  });

  it("rejects stale ranges and forged kinds", async () => {
    const user = await registerVerifiedUser(app, "structured-forged");
    const vimla = await prisma.handle.findUniqueOrThrow({ where: { normalized: "vimla" } });

    await expect(
      routing.resolve({
        userId: user.id,
        content: "prefix @vimla",
        mentions: [
          {
            handleId: vimla.id,
            kind: "SYSTEM_AGENT",
            canonicalHandle: "vimla",
            startOffset: 0,
            endOffset: 6,
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      routing.resolve({
        userId: user.id,
        content: "@vimla",
        mentions: [
          {
            handleId: vimla.id,
            kind: "USER",
            canonicalHandle: "vimla",
            startOffset: 0,
            endOffset: 6,
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
