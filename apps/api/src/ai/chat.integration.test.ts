import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  estimateProviderRequestInputTokens,
  estimateReservationMicroRub,
  seedVimlaAiModels,
  type MockAiProvider,
} from "@vimla/ai";
import { seedVimlaPlans } from "@vimla/billing";
import { loadApiConfig } from "@vimla/config/server";
import { createPrismaClient } from "@vimla/database";
import { createVimlaApiApp } from "../create-app.js";
import { AI_PROVIDER } from "./ai.tokens.js";
import { TextChatService, type StreamSink } from "./text-chat.service.js";
import { registerVerifiedUser } from "../test/identity-helpers.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const origin = "http://localhost:3000";

describe("AI chat integration", () => {
  let app: NestFastifyApplication;
  let chat: TextChatService;
  let provider: MockAiProvider;

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
    process.env.PROJECTS_ENABLED = "true";

    const prisma = createPrismaClient(testDatabaseUrl);
    await seedVimlaPlans(prisma);
    await seedVimlaAiModels(prisma);
    await prisma.$disconnect();

    const config = loadApiConfig(process.env);
    app = await createVimlaApiApp(config, { quiet: true });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    chat = app.get(TextChatService);
    provider = app.get(AI_PROVIDER) as MockAiProvider;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("rejects anonymous model listing", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/ai/models", headers: { origin } });
    expect(response.statusCode).toBe(401);
  });
  it("serializes concurrent legacy first turns onto one persistent thread target", async () => {
    const user = await registerUser(app, "thread-target-race");
    await purchasePro(app, user.cookies);
    const conversation = await createConversation(app, user.cookies);
    const prisma = createPrismaClient(testDatabaseUrl);
    const models = await prisma.aiModel.findMany({
      where: { active: true, visible: true },
      orderBy: { slug: "asc" },
      take: 2,
    });
    const firstModel = models[0];
    const secondModel = models[1];
    if (!firstModel || !secondModel) {
      throw new Error("Expected at least two AI models");
    }
    provider.scenario = "success";

    await Promise.all([
      chat.streamMessage({
        userId: user.id,
        conversationId: conversation.id,
        body: {
          clientRequestId: randomUUID(),
          modelId: firstModel.id,
          content: "Concurrent first turn A",
        },
        correlationId: randomUUID(),
        sink: collectingSink([]),
      }),
      chat.streamMessage({
        userId: user.id,
        conversationId: conversation.id,
        body: {
          clientRequestId: randomUUID(),
          modelId: secondModel.id,
          content: "Concurrent first turn B",
        },
        correlationId: randomUUID(),
        sink: collectingSink([]),
      }),
    ]);

    const persisted = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(persisted.defaultTargetKind).toBe("AI_MODEL");
    const targetModelId = persisted.defaultTargetModelId;
    if (!targetModelId) {
      throw new Error("Expected a persisted thread model");
    }
    expect([firstModel.id, secondModel.id]).toContain(targetModelId);
    const requests = await prisma.aiRequest.findMany({
      where: { userId: user.id, conversationId: conversation.id },
    });
    expect(requests).toHaveLength(2);
    expect(
      new Set(requests.map((request) => request.modelId)),
    ).toEqual(new Set([targetModelId]));
    await prisma.$disconnect();
  });

  it("persists an AI_MODEL thread target and ignores legacy per-message model changes", async () => {
    const user = await registerUser(app, "thread-model-default");
    await purchasePro(app, user.cookies);
    const prisma = createPrismaClient(testDatabaseUrl);
    const models = await prisma.aiModel.findMany({
      where: { active: true, visible: true },
      orderBy: { slug: "asc" },
      take: 2,
    });
    const threadModel = models[0];
    const legacyOtherModel = models[1];
    if (!threadModel || !legacyOtherModel) {
      throw new Error("Expected at least two AI models");
    }

    const created = await app.inject({
      method: "POST",
      url: "/v1/conversations",
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: {
        defaultTarget: {
          kind: "AI_MODEL",
          modelId: threadModel.id,
        },
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().defaultTarget).toEqual({
      kind: "AI_MODEL",
      modelId: threadModel.id,
    });
    const conversationId = String(created.json().id);

    provider.scenario = "success";
    await chat.streamMessage({
      userId: user.id,
      conversationId,
      body: {
        clientRequestId: randomUUID(),
        modelId: legacyOtherModel.id,
        content: "Continue this thread",
      },
      correlationId: randomUUID(),
      sink: collectingSink([]),
    });

    const request = await prisma.aiRequest.findFirstOrThrow({
      where: { userId: user.id, conversationId },
      orderBy: { createdAt: "desc" },
    });
    expect(request.modelId).toBe(threadModel.id);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/conversations/${conversationId}`,
      headers: { origin },
      cookies: user.cookies,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().defaultTarget).toEqual({
      kind: "AI_MODEL",
      modelId: threadModel.id,
    });
    await prisma.$disconnect();
  });

  it("AI_AUTO may change the actual model while preserving one thread history", async () => {
    const user = await registerUser(app, "thread-auto-default");
    await purchasePro(app, user.cookies);
    const created = await app.inject({
      method: "POST",
      url: "/v1/conversations",
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: { defaultTarget: { kind: "AI_AUTO" } },
    });
    expect(created.statusCode).toBe(201);
    const conversationId = String(created.json().id);
    const prisma = createPrismaClient(testDatabaseUrl);

    provider.scenario = "success";
    await chat.streamMessage({
      userId: user.id,
      conversationId,
      body: {
        clientRequestId: randomUUID(),
        content: "First auto turn",
      },
      correlationId: randomUUID(),
      sink: collectingSink([]),
    });
    const first = await prisma.aiRequest.findFirstOrThrow({
      where: { userId: user.id, conversationId },
      orderBy: { createdAt: "desc" },
      include: { model: true },
    });

    await prisma.aiModel.update({
      where: { id: first.modelId },
      data: { active: false },
    });
    try {
      await chat.streamMessage({
        userId: user.id,
        conversationId,
        body: {
          clientRequestId: randomUUID(),
          content: "Second auto turn",
        },
        correlationId: randomUUID(),
        sink: collectingSink([]),
      });
    } finally {
      await prisma.aiModel.update({
        where: { id: first.modelId },
        data: { active: true },
      });
    }

    const requests = await prisma.aiRequest.findMany({
      where: { userId: user.id, conversationId },
      orderBy: { createdAt: "asc" },
      include: { model: true },
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.modelId).toBe(first.modelId);
    expect(requests[1]?.modelId).not.toBe(first.modelId);
    expect(requests.every((request) => request.conversationId === conversationId)).toBe(true);
    expect(requests[0]?.providerModelId).toBe(requests[0]?.model.providerModelId);
    expect(requests[1]?.providerModelId).toBe(requests[1]?.model.providerModelId);
    expect(provider.lastRequest?.messages.some(
      (message) => message.content.includes("First auto turn"),
    )).toBe(true);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/conversations/${conversationId}`,
      headers: { origin },
      cookies: user.cookies,
    });
    expect(detail.json().defaultTarget).toEqual({ kind: "AI_AUTO" });
    await prisma.$disconnect();
  });


  it("authorizes persistent target changes only for the owning conversation", async () => {
    const owner = await registerUser(app, "thread-target-owner");
    const outsider = await registerUser(app, "thread-target-outsider");
    const modelId = await firstModelId(app, owner.cookies);
    const created = await app.inject({
      method: "POST",
      url: "/v1/conversations",
      headers: { origin, "content-type": "application/json" },
      cookies: owner.cookies,
      payload: {
        defaultTarget: { kind: "AI_MODEL", modelId },
      },
    });
    expect(created.statusCode).toBe(201);
    const conversationId = String(created.json().id);

    const denied = await app.inject({
      method: "POST",
      url: `/v1/conversations/${conversationId}/default-target`,
      headers: { origin, "content-type": "application/json" },
      cookies: outsider.cookies,
      payload: { kind: "AI_AUTO" },
    });
    expect(denied.statusCode).toBe(404);

    const changed = await app.inject({
      method: "POST",
      url: `/v1/conversations/${conversationId}/default-target`,
      headers: { origin, "content-type": "application/json" },
      cookies: owner.cookies,
      payload: { kind: "AI_AUTO" },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toEqual({ kind: "AI_AUTO" });

    const invalid = await app.inject({
      method: "POST",
      url: `/v1/conversations/${conversationId}/default-target`,
      headers: { origin, "content-type": "application/json" },
      cookies: owner.cookies,
      payload: {
        kind: "AI_MODEL",
        modelId: "missing-thread-model",
      },
    });
    expect(invalid.statusCode).toBe(400);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/conversations/${conversationId}`,
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().defaultTarget).toEqual({ kind: "AI_AUTO" });
  });

  it("enforces valid persistent target shapes in PostgreSQL", async () => {
    const user = await registerUser(app, "thread-target-constraints");
    const prisma = createPrismaClient(testDatabaseUrl);
    const model = await prisma.aiModel.findFirstOrThrow({
      where: { active: true, visible: true },
    });

    await expect(
      prisma.conversation.create({
        data: {
          userId: user.id,
          kind: "CHAT",
          defaultTargetKind: "AI_AUTO",
          defaultTargetModelId: model.id,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.conversation.create({
        data: {
          userId: user.id,
          kind: "CHAT",
          defaultTargetKind: "AI_MODEL",
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.conversation.create({
        data: {
          userId: user.id,
          kind: "OPERATOR",
          defaultTargetKind: "AI_AUTO",
        },
      }),
    ).rejects.toThrow();

    await prisma.$disconnect();
  });

  it("persists project focus only for current project members", async () => {
    const owner = await registerUser(app, "project-focus-owner");
    const member = await registerUser(app, "project-focus-member");
    const outsider = await registerUser(app, "project-focus-outsider");
    const prisma = createPrismaClient(testDatabaseUrl);
    const project = await prisma.project.create({
      data: {
        ownerUserId: owner.id,
        name: "Focused chat project",
        members: {
          create: {
            userId: member.id,
            role: "MEMBER",
          },
        },
      },
    });
    await prisma.$disconnect();

    const ownerCreated = await app.inject({
      method: "POST",
      url: "/v1/conversations",
      headers: { origin, "content-type": "application/json" },
      cookies: owner.cookies,
      payload: { projectId: project.id },
    });
    expect(ownerCreated.statusCode).toBe(201);
    expect(ownerCreated.json()).toMatchObject({
      projectId: project.id,
    });

    const memberCreated = await app.inject({
      method: "POST",
      url: "/v1/conversations",
      headers: { origin, "content-type": "application/json" },
      cookies: member.cookies,
      payload: { projectId: project.id },
    });
    expect(memberCreated.statusCode).toBe(201);
    expect(memberCreated.json()).toMatchObject({
      projectId: project.id,
    });

    const denied = await app.inject({
      method: "POST",
      url: "/v1/conversations",
      headers: { origin, "content-type": "application/json" },
      cookies: outsider.cookies,
      payload: { projectId: project.id },
    });
    expect(denied.statusCode).toBe(404);

    const ownerDetail = await app.inject({
      method: "GET",
      url: `/v1/conversations/${String(ownerCreated.json().id)}`,
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(ownerDetail.statusCode).toBe(200);
    expect(ownerDetail.json()).toMatchObject({
      projectId: project.id,
    });
  });

  it("rejects injected message fields and providerModelId", async () => {
    const user = await registerUser(app, "inject");
    const conversation = await createConversation(app, user.cookies);
    const response = await app.inject({
      method: "POST",
      url: `/v1/conversations/${conversation.id}/messages`,
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: {
        clientRequestId: randomUUID(),
        modelId: "anything",
        content: "Hi",
        userId: "other",
        role: "SYSTEM",
        providerModelId: "openai/gpt-5.6-luna",
        max_completion_tokens: 999999,
        systemPrompt: "x",
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects an unknown model before calling the provider", async () => {
    const user = await registerUser(app, "unknown");
    await purchasePro(app, user.cookies);
    const conversation = await createConversation(app, user.cookies);
    provider.callCount = 0;
    const events: string[] = [];
    await expect(
      chat.streamMessage({
        userId: user.id,
        conversationId: conversation.id,
        body: {
          clientRequestId: randomUUID(),
          modelId: "missing-model",
          content: "Hello",
        },
        correlationId: randomUUID(),
        sink: collectingSink(events),
      }),
    ).rejects.toMatchObject({ code: "UNKNOWN_MODEL" });
    expect(provider.callCount).toBe(0);
  });

  it("does not call the provider when the user has no usage", async () => {
    const user = await registerUser(app, "nousage");
    const conversation = await createConversation(app, user.cookies);
    const modelId = await firstModelId(app, user.cookies);
    provider.callCount = 0;
    await expect(
      chat.streamMessage({
        userId: user.id,
        conversationId: conversation.id,
        body: { clientRequestId: randomUUID(), modelId, content: "Hello" },
        correlationId: randomUUID(),
        sink: collectingSink([]),
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_USAGE" });
    expect(provider.callCount).toBe(0);
  });

  it("shrinks the provider output cap to the remaining funded allowance", async () => {
    const user = await registerUser(app, "shrink");
    const conversation = await createConversation(app, user.cookies);
    const prisma = createPrismaClient(testDatabaseUrl);
    const model = await prisma.aiModel.findUniqueOrThrow({
      where: { slug: "gpt-5-6-luna" },
      include: {
        priceVersions: {
          where: { effectiveTo: null },
          orderBy: { effectiveFrom: "desc" },
          take: 1,
        },
      },
    });
    const price = model.priceVersions[0];
    if (!price) throw new Error("Expected an active Luna price version");

    const estimatedInputTokens = estimateProviderRequestInputTokens([
      { role: "user", content: "Hello" },
    ]);
    const quote = {
      inputMicroRubPerMillion: price.inputMicroRubPerMillion,
      outputMicroRubPerMillion: price.outputMicroRubPerMillion,
      cacheReadMicroRubPerMillion: price.cacheReadMicroRubPerMillion,
      cacheWriteMicroRubPerMillion: price.cacheWriteMicroRubPerMillion,
    };
    const minimumCost = estimateReservationMicroRub({
      estimatedInputTokens: BigInt(estimatedInputTokens),
      maxOutputTokens: 768n,
      price: quote,
      safetyBps: 2_000n,
    });
    const preferredCost = estimateReservationMicroRub({
      estimatedInputTokens: BigInt(estimatedInputTokens),
      maxOutputTokens: 2_048n,
      price: quote,
      safetyBps: 2_000n,
    });
    const fundedAllowance =
      minimumCost + (preferredCost - minimumCost) / 2n;
    expect(fundedAllowance).toBeGreaterThanOrEqual(minimumCost);
    expect(fundedAllowance).toBeLessThan(preferredCost);

    await prisma.usageBucket.create({
      data: {
        userId: user.id,
        type: "TOPUP",
        totalMicroRub: fundedAllowance,
        spentMicroRub: 0n,
        reservedMicroRub: 0n,
        expiresAt: null,
        sourceType: "TEST",
        sourceId: `chat-shrink:${randomUUID()}`,
      },
    });
    await prisma.$disconnect();
    const modelId = model.id;

    provider.scenario = "success";
    provider.callCount = 0;
    await chat.streamMessage({
      userId: user.id,
      conversationId: conversation.id,
      body: { clientRequestId: randomUUID(), modelId, content: "Hello" },
      correlationId: randomUUID(),
      sink: collectingSink([]),
    });

    const check = createPrismaClient(testDatabaseUrl);
    const request = await check.aiRequest.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: { reservation: true },
    });
    expect(request.maxOutputTokens).toBeGreaterThanOrEqual(768);
    expect(request.maxOutputTokens).toBeLessThan(2_048);
    expect(request.estimatedCostMicroRub).toBeLessThanOrEqual(
      fundedAllowance,
    );
    expect(request.reservation?.estimatedMicroRub).toBe(
      request.estimatedCostMicroRub,
    );
    expect(provider.lastRequest?.maxOutputTokens).toBe(
      request.maxOutputTokens,
    );
    await check.$disconnect();
  });

  it("reserves, streams, settles, and persists the assistant message", async () => {
    const user = await registerUser(app, "ok");
    await purchasePro(app, user.cookies);
    const conversation = await createConversation(app, user.cookies);
    const modelId = await firstModelId(app, user.cookies);
    provider.scenario = "success";
    provider.callCount = 0;
    const events: string[] = [];
    await chat.streamMessage({
      userId: user.id,
      conversationId: conversation.id,
      body: { clientRequestId: randomUUID(), modelId, content: "Hello" },
      correlationId: randomUUID(),
      sink: collectingSink(events),
    });
    expect(provider.callCount).toBe(1);
    expect(events.join("")).toContain("event: done");
    const detail = await app.inject({
      method: "GET",
      url: `/v1/conversations/${conversation.id}`,
      headers: { origin },
      cookies: user.cookies,
    });
    const body = detail.json() as { messages: Array<{ role: string; content: string }> };
    expect(body.messages.some((message) => message.role === "ASSISTANT")).toBe(true);
  });

  it("streams mock text over HTTP with CORS headers on the hijacked SSE response", async () => {
    const user = await registerUser(app, "http-sse");
    await purchasePro(app, user.cookies);
    const conversation = await createConversation(app, user.cookies);
    const modelId = await firstModelId(app, user.cookies);
    const response = await app.inject({
      method: "POST",
      url: `/v1/conversations/${conversation.id}/messages`,
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: {
        clientRequestId: randomUUID(),
        modelId,
        content: "Hello",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(origin);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.body).toContain("Hello fr");
    expect(response.body).toContain("om Vimla");
    expect(response.body).toContain("event: done");
  });

  it("rejects reusing one clientRequestId across different conversations", async () => {
    const user = await registerUser(app, "cross-conversation-idempotency");
    await purchasePro(app, user.cookies);
    const firstConversation = await createConversation(app, user.cookies);
    const secondConversation = await createConversation(app, user.cookies);
    const modelId = await firstModelId(app, user.cookies);
    const clientRequestId = randomUUID();
    provider.scenario = "success";

    await chat.streamMessage({
      userId: user.id,
      conversationId: firstConversation.id,
      body: { clientRequestId, modelId, content: "First conversation" },
      correlationId: randomUUID(),
      sink: collectingSink([]),
    });

    await expect(
      chat.streamMessage({
        userId: user.id,
        conversationId: secondConversation.id,
        body: { clientRequestId, modelId, content: "Second conversation" },
        correlationId: randomUUID(),
        sink: collectingSink([]),
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const prisma = createPrismaClient(testDatabaseUrl);
    expect(
      await prisma.aiRequest.count({
        where: { userId: user.id, clientRequestId },
      }),
    ).toBe(1);
    expect(
      await prisma.message.count({
        where: {
          conversationId: secondConversation.id,
          role: "USER",
          content: "Second conversation",
        },
      }),
    ).toBe(0);
    await prisma.$disconnect();
  });

  it("calls the provider at most once for duplicate clientRequestId, including parallel calls", async () => {
    const user = await registerUser(app, "dup");
    await purchasePro(app, user.cookies);
    const conversation = await createConversation(app, user.cookies);
    const modelId = await firstModelId(app, user.cookies);
    const clientRequestId = randomUUID();
    provider.scenario = "success";
    provider.callCount = 0;
    const results = await Promise.allSettled([
      chat.streamMessage({
        userId: user.id,
        conversationId: conversation.id,
        body: { clientRequestId, modelId, content: "Hello" },
        correlationId: randomUUID(),
        sink: collectingSink([]),
      }),
      chat.streamMessage({
        userId: user.id,
        conversationId: conversation.id,
        body: { clientRequestId, modelId, content: "Hello" },
        correlationId: randomUUID(),
        sink: collectingSink([]),
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect(provider.callCount).toBe(1);
  });

  it("does not treat missing usage as zero cost", async () => {
    const user = await registerUser(app, "miss");
    await purchasePro(app, user.cookies);
    const conversation = await createConversation(app, user.cookies);
    const modelId = await firstModelId(app, user.cookies);
    provider.scenario = "missing-usage";
    await expect(
      chat.streamMessage({
        userId: user.id,
        conversationId: conversation.id,
        body: { clientRequestId: randomUUID(), modelId, content: "Hello" },
        correlationId: randomUUID(),
        sink: collectingSink([]),
      }),
    ).rejects.toMatchObject({ code: "AI_RECONCILIATION_REQUIRED" });

    const prisma = createPrismaClient(testDatabaseUrl);
    const request = await prisma.aiRequest.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    expect(request.status).toBe("RECONCILIATION_REQUIRED");
    expect(request.userSettledUsageMicroRub).toBeNull();
    if (request.reservationId) {
      const reservation = await prisma.usageReservation.findUniqueOrThrow({
        where: { id: request.reservationId },
      });
      expect(reservation.status).toBe("ACTIVE");
    }
    await prisma.$disconnect();
    provider.scenario = "success";
  });

  it("settles known usage after an interrupted provider stream without succeeding semantically", async () => {
    const user = await registerUser(app, "usage-interrupt");
    await purchasePro(app, user.cookies);
    const conversation = await createConversation(app, user.cookies);
    const modelId = await firstModelId(app, user.cookies);
    provider.scenario = "usage-then-ambiguous";

    await expect(
      chat.streamMessage({
        userId: user.id,
        conversationId: conversation.id,
        body: { clientRequestId: randomUUID(), modelId, content: "Hello" },
        correlationId: randomUUID(),
        sink: collectingSink([]),
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_AMBIGUOUS_FAILURE" });

    const prisma = createPrismaClient(testDatabaseUrl);
    const request = await prisma.aiRequest.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: { reservation: true },
    });
    expect(request.status).toBe("FAILED");
    expect(request.financialStatus).toBe("SETTLED");
    expect(request.providerActualCostMicroRub).not.toBeNull();
    expect(request.userSettledUsageMicroRub).toBe(
      request.providerActualCostMicroRub,
    );
    expect(request.reservation?.status).toBe("SETTLED");
    expect(request.outputText).toBeNull();
    await prisma.$disconnect();
    provider.scenario = "success";
  });

  it("continues settlement after the client disconnects", async () => {
    const user = await registerUser(app, "disc");
    await purchasePro(app, user.cookies);
    const conversation = await createConversation(app, user.cookies);
    const modelId = await firstModelId(app, user.cookies);
    provider.scenario = "success";
    let open = true;
    const sink: StreamSink = {
      isClientOpen: () => open,
      write: () => {
        open = false;
      },
    };
    await chat.streamMessage({
      userId: user.id,
      conversationId: conversation.id,
      body: { clientRequestId: randomUUID(), modelId, content: "Hello" },
      correlationId: randomUUID(),
      sink,
    });
    const prisma = createPrismaClient(testDatabaseUrl);
    const request = await prisma.aiRequest.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    expect(request.status).toBe("SUCCEEDED");
    expect(request.userSettledUsageMicroRub).not.toBeNull();
    await prisma.$disconnect();
  });

  it("holds a provider boundedness violation instead of topping up after the call", async () => {
    const user = await registerUser(app, "anom");
    await purchasePro(app, user.cookies);
    const conversation = await createConversation(app, user.cookies);
    const modelId = await firstModelId(app, user.cookies);
    provider.scenario = "expensive";

    await expect(
      chat.streamMessage({
        userId: user.id,
        conversationId: conversation.id,
        body: { clientRequestId: randomUUID(), modelId, content: "Hello" },
        correlationId: randomUUID(),
        sink: collectingSink([]),
      }),
    ).rejects.toMatchObject({ code: "AI_RECONCILIATION_REQUIRED" });

    const prisma = createPrismaClient(testDatabaseUrl);
    const request = await prisma.aiRequest.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: { reservation: true },
    });
    expect(request.status).toBe("RECONCILIATION_REQUIRED");
    expect(request.financialStatus).toBe("RECONCILIATION_HOLD");
    expect(request.providerActualCostMicroRub).not.toBeNull();
    expect(request.providerActualCostMicroRub ?? 0n).toBeGreaterThan(
      request.estimatedCostMicroRub,
    );
    expect(request.userSettledUsageMicroRub).toBeNull();
    expect(request.reservation?.status).toBe("ACTIVE");

    const buckets = await prisma.usageBucket.findMany({
      where: { userId: user.id },
    });
    for (const bucket of buckets) {
      expect(bucket.spentMicroRub).toBe(0n);
      expect(
        bucket.spentMicroRub + bucket.reservedMicroRub,
      ).toBeLessThanOrEqual(bucket.totalMicroRub);
    }
    await prisma.$disconnect();
    provider.scenario = "success";
  });

  it("prevents user B from reading user A conversations", async () => {
    const userA = await registerUser(app, "owna");
    const userB = await registerUser(app, "ownb");
    const conversation = await createConversation(app, userA.cookies);
    const response = await app.inject({
      method: "GET",
      url: `/v1/conversations/${conversation.id}`,
      headers: { origin },
      cookies: userB.cookies,
    });
    expect(response.statusCode).toBe(404);
  });

  it("rejects oversized messages before the provider is called", async () => {
    const user = await registerUser(app, "huge");
    await purchasePro(app, user.cookies);
    const conversation = await createConversation(app, user.cookies);
    const modelId = await firstModelId(app, user.cookies);
    provider.callCount = 0;
    await expect(
      chat.streamMessage({
        userId: user.id,
        conversationId: conversation.id,
        body: {
          clientRequestId: randomUUID(),
          modelId,
          content: "x".repeat(20_000),
        },
        correlationId: randomUUID(),
        sink: collectingSink([]),
      }),
    ).rejects.toMatchObject({ code: "MESSAGE_TOO_LARGE" });
    expect(provider.callCount).toBe(0);
  });

  it("rejects untrusted origins on mutating chat routes", async () => {
    const user = await registerUser(app, "csrf");
    const response = await app.inject({
      method: "POST",
      url: "/v1/conversations",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      cookies: user.cookies,
      payload: {},
    });
    expect(response.statusCode).toBe(403);
  });

  it("rejects inactive models and models without an active price version", async () => {
    const user = await registerUser(app, "inactive");
    await purchasePro(app, user.cookies);
    const conversation = await createConversation(app, user.cookies);
    const modelId = await firstModelId(app, user.cookies);
    const prisma = createPrismaClient(testDatabaseUrl);
    provider.callCount = 0;
    await prisma.aiModel.update({ where: { id: modelId }, data: { active: false } });
    await expect(
      chat.streamMessage({
        userId: user.id,
        conversationId: conversation.id,
        body: { clientRequestId: randomUUID(), modelId, content: "Hello" },
        correlationId: randomUUID(),
        sink: collectingSink([]),
      }),
    ).rejects.toMatchObject({ code: "INACTIVE_MODEL" });
    expect(provider.callCount).toBe(0);

    await prisma.aiModel.update({ where: { id: modelId }, data: { active: true } });
    await prisma.aiModelPriceVersion.updateMany({
      where: { modelId },
      data: { effectiveTo: new Date("2020-01-01T00:00:00.000Z") },
    });
    await expect(
      chat.streamMessage({
        userId: user.id,
        conversationId: conversation.id,
        body: { clientRequestId: randomUUID(), modelId, content: "Hello" },
        correlationId: randomUUID(),
        sink: collectingSink([]),
      }),
    ).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
    expect(provider.callCount).toBe(0);
    await prisma.aiModelPriceVersion.updateMany({
      where: { modelId },
      data: { effectiveTo: null },
    });
    await prisma.$disconnect();
  });

  it("caps concurrent text generations per user", async () => {
    const user = await registerUser(app, "conc");
    await purchasePro(app, user.cookies);
    const conversation = await createConversation(app, user.cookies);
    const modelId = await firstModelId(app, user.cookies);
    provider.scenario = "success";
    provider.delayMs = 400;
    provider.callCount = 0;
    const results = await Promise.allSettled([
      chat.streamMessage({
        userId: user.id,
        conversationId: conversation.id,
        body: { clientRequestId: randomUUID(), modelId, content: "One" },
        correlationId: randomUUID(),
        sink: collectingSink([]),
      }),
      chat.streamMessage({
        userId: user.id,
        conversationId: conversation.id,
        body: { clientRequestId: randomUUID(), modelId, content: "Two" },
        correlationId: randomUUID(),
        sink: collectingSink([]),
      }),
      chat.streamMessage({
        userId: user.id,
        conversationId: conversation.id,
        body: { clientRequestId: randomUUID(), modelId, content: "Three" },
        correlationId: randomUUID(),
        sink: collectingSink([]),
      }),
    ]);
    provider.delayMs = 0;
    expect(results.filter((result) => result.status === "rejected").length).toBeGreaterThanOrEqual(1);
    expect(provider.callCount).toBeLessThanOrEqual(2);
  });

  it("does not expose the ProxyAPI key in stream errors", async () => {
    const user = await registerUser(app, "secret");
    await purchasePro(app, user.cookies);
    const conversation = await createConversation(app, user.cookies);
    const modelId = await firstModelId(app, user.cookies);
    provider.scenario = "reject";
    await expect(
      chat.streamMessage({
        userId: user.id,
        conversationId: conversation.id,
        body: { clientRequestId: randomUUID(), modelId, content: "Hello" },
        correlationId: randomUUID(),
        sink: collectingSink([]),
      }),
    ).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof Error)) {
        return false;
      }
      const serialized = `${error.name}:${error.message}:${error.stack ?? ""}`;
      return !serialized.includes("sk-") && !serialized.toLowerCase().includes("proxyapi_api_key");
    });
    provider.scenario = "success";
  });

  it("prevents user B from appending to user A conversations", async () => {
    const userA = await registerUser(app, "posta");
    const userB = await registerUser(app, "postb");
    await purchasePro(app, userB.cookies);
    const conversation = await createConversation(app, userA.cookies);
    const modelId = await firstModelId(app, userB.cookies);
    const response = await app.inject({
      method: "POST",
      url: `/v1/conversations/${conversation.id}/messages`,
      headers: { origin, "content-type": "application/json" },
      cookies: userB.cookies,
      payload: {
        clientRequestId: randomUUID(),
        modelId,
        content: "Hello",
      },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("AI kill switch", () => {
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
    process.env.BETTER_AUTH_SECRET = "local-dev-only-change-me-use-32-chars-min";
    process.env.BETTER_AUTH_URL = "http://localhost:3001";
    process.env.AI_TEXT_ENABLED = "false";
    process.env.AI_TEXT_PROVIDER = "mock";

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

  it("does not call the provider when AI is disabled", async () => {
    const user = await registerUser(app, "off");
    const conversation = await createConversation(app, user.cookies);
    const modelId = await firstModelId(app, user.cookies);
    const provider = app.get(AI_PROVIDER) as MockAiProvider;
    provider.callCount = 0;
    const chat = app.get(TextChatService);
    await expect(
      chat.streamMessage({
        userId: user.id,
        conversationId: conversation.id,
        body: { clientRequestId: randomUUID(), modelId, content: "Hello" },
        correlationId: randomUUID(),
        sink: collectingSink([]),
      }),
    ).rejects.toMatchObject({ code: "AI_DISABLED" });
    expect(provider.callCount).toBe(0);
  });
});

function collectingSink(events: string[]): StreamSink {
  return {
    isClientOpen: () => true,
    write: (chunk) => {
      events.push(chunk);
    },
  };
}

async function registerUser(
  app: NestFastifyApplication,
  label: string,
): Promise<{ cookies: Record<string, string>; id: string }> {
  const user = await registerVerifiedUser(app, label);
  return { cookies: user.cookies, id: user.id };
}

async function purchasePro(
  app: NestFastifyApplication,
  cookies: Record<string, string>,
): Promise<void> {
  const response = await app.inject({
    method: "POST",
    url: "/dev/mock-purchases/subscription",
    headers: { origin, "content-type": "application/json" },
    cookies,
    payload: { planCode: "PRO" },
  });
  expect(response.statusCode).toBe(201);
}

async function createConversation(
  app: NestFastifyApplication,
  cookies: Record<string, string>,
): Promise<{ id: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/conversations",
    headers: { origin, "content-type": "application/json" },
    cookies,
    payload: {},
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string };
}

async function firstModelId(
  app: NestFastifyApplication,
  cookies: Record<string, string>,
): Promise<string> {
  const response = await app.inject({
    method: "GET",
    url: "/v1/ai/models",
    headers: { origin },
    cookies,
  });
  expect(response.statusCode).toBe(200);
  const payload = response.json() as { models: Array<{ id: string }> };
  const model = payload.models[0];
  if (!model) {
    throw new Error("Expected at least one retail model");
  }
  return model.id;
}
