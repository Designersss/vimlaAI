import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { seedVimlaAiModels } from "@vimla/ai";
import { loadApiConfig } from "@vimla/config/server";
import { mentionSuggestionsResponseSchema } from "@vimla/contracts";
import { createPrismaClient } from "@vimla/database";
import { createVimlaApiApp } from "../create-app.js";
import { registerVerifiedUser } from "../test/identity-helpers.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for mention integration tests");
}

const origin = "http://localhost:3000";

describe("contextual mention resolver", () => {
  let app: NestFastifyApplication;
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
    process.env.AI_TEXT_PROVIDER = "mock";

    await seedVimlaAiModels(prisma);
    app = await createVimlaApiApp(loadApiConfig(process.env), { quiet: true });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (app) await app.close();
  });

  it("returns only candidates belonging to the requested conversation surface", async () => {
    const alice = await registerVerifiedUser(app, "mention-alice");
    const bob = await registerVerifiedUser(app, "mention-bob");
    const stranger = await registerVerifiedUser(app, "mention-stranger");

    const handleRows = await prisma.handle.findMany({
      where: { userId: { in: [alice.id, bob.id, stranger.id] }, kind: "USER", status: "ACTIVE" },
      select: { userId: true, handle: true },
    });
    const handleByUser = new Map(handleRows.map((row) => [row.userId, row.handle]));
    const aliceHandle = handleByUser.get(alice.id);
    const bobHandle = handleByUser.get(bob.id);
    const strangerHandle = handleByUser.get(stranger.id);
    expect(aliceHandle).toBeTruthy();
    expect(bobHandle).toBeTruthy();
    expect(strangerHandle).toBeTruthy();

    const conversation = await prisma.conversation.create({
      data: { userId: alice.id, title: "Mentions" },
    });
    const project = await prisma.project.create({
      data: {
        ownerUserId: alice.id,
        name: "Mention Project",
        members: { create: [{ userId: bob.id, role: "MEMBER" }] },
      },
    });
    const direct = await prisma.directConversation.create({
      data: {
        pairKey: `mentions:${alice.id}:${bob.id}`,
        members: {
          create: [{ userId: alice.id }, { userId: bob.id }],
        },
      },
    });

    const chatResponse = await app.inject({
      method: "GET",
      url: `/v1/mentions?conversationId=${conversation.id}`,
      headers: { origin },
      cookies: alice.cookies,
    });
    expect(chatResponse.statusCode).toBe(200);
    const chat = mentionSuggestionsResponseSchema.parse(chatResponse.json());
    expect(chat.people.map((candidate) => candidate.handle)).toEqual([aliceHandle]);
    expect(chat.vimla.map((candidate) => candidate.handle)).toEqual(["vimla"]);
    expect(chat.ai[0]?.handle).toBe("auto");
    expect(chat.ai.some((candidate) => candidate.kind === "AI_MODEL")).toBe(true);

    const projectResponse = await app.inject({
      method: "GET",
      url: `/v1/mentions?projectId=${project.id}`,
      headers: { origin },
      cookies: alice.cookies,
    });
    expect(projectResponse.statusCode).toBe(200);
    const projectSuggestions = mentionSuggestionsResponseSchema.parse(projectResponse.json());
    expect(new Set(projectSuggestions.people.map((candidate) => candidate.handle))).toEqual(
      new Set([aliceHandle, bobHandle]),
    );
    expect(projectSuggestions.people.map((candidate) => candidate.handle)).not.toContain(strangerHandle);

    const filteredResponse = await app.inject({
      method: "GET",
      url: `/v1/mentions?projectId=${project.id}&q=${encodeURIComponent(bobHandle ?? "")}`,
      headers: { origin },
      cookies: alice.cookies,
    });
    expect(filteredResponse.statusCode).toBe(200);
    const filtered = mentionSuggestionsResponseSchema.parse(filteredResponse.json());
    expect(filtered.people.map((candidate) => candidate.handle)).toEqual([bobHandle]);

    const directResponse = await app.inject({
      method: "GET",
      url: `/v1/mentions?directConversationId=${direct.id}`,
      headers: { origin },
      cookies: alice.cookies,
    });
    expect(directResponse.statusCode).toBe(200);
    const directSuggestions = mentionSuggestionsResponseSchema.parse(directResponse.json());
    expect(new Set(directSuggestions.people.map((candidate) => candidate.handle))).toEqual(
      new Set([aliceHandle, bobHandle]),
    );
    expect(directSuggestions.people.map((candidate) => candidate.handle)).not.toContain(strangerHandle);

    const strangerResponse = await app.inject({
      method: "GET",
      url: `/v1/mentions?directConversationId=${direct.id}`,
      headers: { origin },
      cookies: stranger.cookies,
    });
    expect(strangerResponse.statusCode).toBe(404);
  });
});
