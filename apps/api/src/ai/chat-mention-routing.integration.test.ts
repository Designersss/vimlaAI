import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { loadApiConfig } from "@vimla/config/server";
import { createPrismaClient } from "@vimla/database";
import { createVimlaApiApp } from "../create-app.js";
import { registerVerifiedUser } from "../test/identity-helpers.js";
import { ChatMentionRoutingService } from "./chat-mention-routing.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for structured mention integration tests");
}

const origin = "http://localhost:3000";

describe("structured normal-chat mention routing", () => {
  let app: NestFastifyApplication;
  let routing: ChatMentionRoutingService;
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

    app = await createVimlaApiApp(loadApiConfig(process.env), { quiet: true });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    routing = app.get(ChatMentionRoutingService);
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
