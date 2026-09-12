import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AiRequestReconciler, seedVimlaAiModels, type MockAiProvider } from "@vimla/ai";
import { BillingEngine, DEFAULT_BILLING_POLICY, seedVimlaPlans } from "@vimla/billing";
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

  it("keeps full provider COGS when actual exceeds the reservation", async () => {
    const user = await registerUser(app, "anom");
    await purchasePro(app, user.cookies);
    const conversation = await createConversation(app, user.cookies);
    const modelId = await firstModelId(app, user.cookies);
    provider.scenario = "expensive";
    await chat.streamMessage({
      userId: user.id,
      conversationId: conversation.id,
      body: { clientRequestId: randomUUID(), modelId, content: "Hello" },
      correlationId: randomUUID(),
      sink: collectingSink([]),
    });
    const prisma = createPrismaClient(testDatabaseUrl);
    const request = await prisma.aiRequest.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    expect(request.providerActualCostMicroRub).not.toBeNull();
    expect(request.userSettledUsageMicroRub).not.toBeNull();
    expect(request.providerActualCostMicroRub ?? 0n).toBeGreaterThan(
      request.userSettledUsageMicroRub ?? 0n,
    );
    expect(request.financialStatus).toBe("ANOMALY");
    const buckets = await prisma.usageBucket.findMany({ where: { userId: user.id } });
    for (const bucket of buckets) {
      expect(bucket.spentMicroRub + bucket.reservedMicroRub <= bucket.totalMicroRub).toBe(true);
      expect(bucket.spentMicroRub >= 0n).toBe(true);
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

  it("durably reconciles every stale AI crash window idempotently", async () => {
    const user = await registerUser(app, "recover");
    await purchasePro(app, user.cookies);
    const conversation = await createConversation(app, user.cookies);
    const prisma = createPrismaClient(testDatabaseUrl);
    const model = await prisma.aiModel.findFirstOrThrow({ include: { priceVersions: true } });
    const priceVersion = model.priceVersions[0];
    if (!priceVersion) throw new Error("expected price version");
    const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
    const engine = new BillingEngine(prisma, DEFAULT_BILLING_POLICY, logger);
    const reconciler = new AiRequestReconciler(prisma, engine, logger);
    const stale = new Date(Date.now() - 60_000);
    const createRequest = (status: string, suffix: string) => prisma.aiRequest.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        modelId: model.id,
        priceVersionId: priceVersion.id,
        clientRequestId: randomUUID(),
        provider: model.provider,
        providerModelId: model.providerModelId,
        status,
        financialStatus: status === "CREATED" ? "NONE" : "RESERVED",
        estimatedInputTokens: 1,
        maxOutputTokens: 1,
        estimatedCostMicroRub: 1_000n,
        createdAt: new Date(stale.getTime() - Number(suffix) * 1_000),
      },
    });

    const beforeReservation = await createRequest("CREATED", "1");
    const afterReservation = await createRequest("CREATED", "2");
    const orphanReservation = await engine.reserveUsage({ userId: user.id, requestId: afterReservation.id, estimatedProviderCostMicroRub: 1_000n });
    const reserved = await createRequest("RESERVED", "3");
    const linkedReservation = await engine.reserveUsage({ userId: user.id, requestId: reserved.id, estimatedProviderCostMicroRub: 1_000n });
    await prisma.aiRequest.update({ where: { id: reserved.id }, data: { reservationId: linkedReservation.id } });
    const providerStarted = await createRequest("PROVIDER_STARTED", "4");
    const ambiguousReservation = await engine.reserveUsage({ userId: user.id, requestId: providerStarted.id, estimatedProviderCostMicroRub: 1_000n });
    await prisma.aiRequest.update({ where: { id: providerStarted.id }, data: { reservationId: ambiguousReservation.id, startedAt: stale } });
    const streaming = await createRequest("STREAMING", "6");
    const streamingReservation = await engine.reserveUsage({ userId: user.id, requestId: streaming.id, estimatedProviderCostMicroRub: 1_000n });
    await prisma.aiRequest.update({ where: { id: streaming.id }, data: { reservationId: streamingReservation.id, startedAt: stale, providerRequestId: "durable-provider-id" } });
    const usageKnown = await createRequest("RECONCILIATION_REQUIRED", "5");
    const knownReservation = await engine.reserveUsage({ userId: user.id, requestId: usageKnown.id, estimatedProviderCostMicroRub: 1_000n });
    await prisma.aiRequest.update({ where: { id: usageKnown.id }, data: { reservationId: knownReservation.id, providerActualCostMicroRub: 700n } });

    const first = await reconciler.reconcile(stale, 20);
    const [second, concurrentWorker] = await Promise.all([
      reconciler.reconcile(stale, 20),
      reconciler.reconcile(stale, 20),
    ]);
    expect(first).toMatchObject({ scanned: 6, released: 2, settled: 1, held: 2, failedBeforeReservation: 1, errors: 0 });
    expect(second.scanned).toBe(2);
    expect(concurrentWorker.scanned).toBe(2);
    expect((await prisma.usageReservation.findUniqueOrThrow({ where: { id: orphanReservation.id } })).status).toBe("RELEASED");
    expect((await prisma.usageReservation.findUniqueOrThrow({ where: { id: linkedReservation.id } })).status).toBe("RELEASED");
    expect((await prisma.usageReservation.findUniqueOrThrow({ where: { id: ambiguousReservation.id } })).status).toBe("ACTIVE");
    expect((await prisma.usageReservation.findUniqueOrThrow({ where: { id: streamingReservation.id } })).status).toBe("ACTIVE");
    expect((await prisma.usageReservation.findUniqueOrThrow({ where: { id: knownReservation.id } })).status).toBe("SETTLED");
    expect((await prisma.aiRequest.findUniqueOrThrow({ where: { id: beforeReservation.id } })).status).toBe("FAILED");
    expect((await prisma.aiRequest.findUniqueOrThrow({ where: { id: providerStarted.id } })).status).toBe("RECONCILIATION_REQUIRED");
    await prisma.$disconnect();
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
