import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { loadApiConfig } from "@vimla/config/server";
import { createPrismaClient } from "@vimla/database";
import { createVimlaApiApp } from "../create-app.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { registerVerifiedUser } from "../test/identity-helpers.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const origin = "http://localhost:3000";

describe("unified inbox API", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "test";
    process.env.LOG_LEVEL = "error";
    process.env.API_HOST = "127.0.0.1";
    process.env.API_PORT = "3001";
    process.env.WEB_ORIGIN = origin;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.REDIS_URL =
      process.env.REDIS_URL ??
      "redis://localhost:6379";
    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET ??
      "local-dev-only-change-me-use-32-chars-min";
    process.env.BETTER_AUTH_URL =
      process.env.BETTER_AUTH_URL ??
      "http://localhost:3001";
    process.env.DIRECT_CHATS_ENABLED = "true";

    const prisma =
      createPrismaClient(testDatabaseUrl);
    await prisma.$disconnect();

    const config = loadApiConfig(process.env);
    app = await createVimlaApiApp(config, {
      quiet: true,
    });
    await app.init();
    await app
      .getHttpAdapter()
      .getInstance()
      .ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("returns one authorized stable mixed feed without Direct plaintext", async () => {
    const alice = await registerVerifiedUser(
      app,
      "inbox-alice",
    );
    const bob = await registerVerifiedUser(
      app,
      "inbox-bob",
    );
    const oscar = await registerVerifiedUser(
      app,
      "inbox-oscar",
    );
    const db = app.get(PrismaService).client;

    const ai = await db.conversation.create({
      data: {
        userId: alice.id,
        kind: "CHAT",
        title: "Roadmap AI",
      },
    });
    const aiAt = new Date(
      "2026-10-02T05:00:00.000Z",
    );
    await db.message.create({
      data: {
        conversationId: ai.id,
        role: "ASSISTANT",
        content: "AI preview is server visible",
        status: "COMPLETE",
        createdAt: aiAt,
      },
    });

    const direct =
      await db.directConversation.create({
        data: {
          pairKey: `inbox-${randomUUID()}`,
          members: {
            create: [
              { userId: alice.id },
              { userId: bob.id },
            ],
          },
        },
      });
    const senderDevice =
      await db.userCryptoDevice.create({
        data: {
          userId: bob.id,
          identityEd25519Public:
            "inbox-ed25519-public",
          identityX25519Public:
            "inbox-x25519-public",
          signedPrekeyId: 1,
          signedPrekeyPublic:
            "inbox-signed-prekey-public",
          signedPrekeySignature:
            "inbox-signed-prekey-signature",
        },
      });
    const directAt = new Date(
      "2026-10-02T05:01:00.000Z",
    );
    const directMessage =
      await db.directMessage.create({
        data: {
          conversationId: direct.id,
          senderUserId: bob.id,
          senderDeviceId: senderDevice.id,
          clientMessageId: randomUUID(),
          kind: "HUMAN",
          createdAt: directAt,
        },
      });

    const foreign =
      await db.directConversation.create({
        data: {
          pairKey: `inbox-foreign-${randomUUID()}`,
          members: {
            create: [
              { userId: bob.id },
              { userId: oscar.id },
            ],
          },
        },
      });
    const foreignSurface =
      await db.communicationSurface.findUniqueOrThrow(
        {
          where: {
            directConversationId: foreign.id,
          },
        },
      );

    const response = await app.inject({
      method: "GET",
      url: "/v1/inbox",
      headers: { origin },
      cookies: alice.cookies,
    });
    expect(response.statusCode).toBe(200);
    const payload = response.json() as {
      items: Array<Record<string, unknown>>;
      nextCursor: string | null;
    };

    const directItem = payload.items.find(
      (item) => item.domainId === direct.id,
    );
    const aiItem = payload.items.find(
      (item) => item.domainId === ai.id,
    );
    expect(directItem).toMatchObject({
      surfaceKind: "DIRECT",
      domainId: direct.id,
      title: bob.name,
      unreadCount: 1,
      lastActivityAt: directAt.toISOString(),
      preview: {
        kind: "E2EE_LOCAL",
        messageId: directMessage.id,
        senderUserId: bob.id,
        messageKind: "HUMAN",
        createdAt: directAt.toISOString(),
      },
    });
    expect(aiItem).toMatchObject({
      surfaceKind: "AI_THREAD",
      domainId: ai.id,
      title: "Roadmap AI",
      unreadCount: 0,
      lastActivityAt: aiAt.toISOString(),
      preview: {
        kind: "SERVER_TEXT",
        role: "ASSISTANT",
        text: "AI preview is server visible",
      },
    });

    const directIndex = payload.items.findIndex(
      (item) => item.domainId === direct.id,
    );
    const aiIndex = payload.items.findIndex(
      (item) => item.domainId === ai.id,
    );
    expect(directIndex).toBeGreaterThanOrEqual(0);
    expect(aiIndex).toBeGreaterThanOrEqual(0);
    expect(directIndex).toBeLessThan(aiIndex);
    expect(
      payload.items.some(
        (item) =>
          item.surfaceId === foreignSurface.id,
      ),
    ).toBe(false);
    expect(response.body).not.toContain(
      "ciphertext",
    );
    expect(response.body).not.toContain(
      "inbox-signed-prekey",
    );

    const directSurface =
      await db.communicationSurface.findUniqueOrThrow(
        {
          where: {
            directConversationId: direct.id,
          },
        },
      );
    expect(directItem).toMatchObject({
      navigationTarget: {
        version: 1,
        kind: "CHAT",
        id: directSurface.id,
      },
    });

    const directSearch = await app.inject({
      method: "GET",
      url: "/v1/inbox?q=Bob",
      headers: { origin },
      cookies: alice.cookies,
    });
    expect(directSearch.statusCode).toBe(200);
    expect(
      directSearch
        .json()
        .items.map(
          (item: { surfaceKind: string }) =>
            item.surfaceKind,
        ),
    ).toContain("DIRECT");

    const aiFilter = await app.inject({
      method: "GET",
      url: "/v1/inbox?kind=AI_THREAD&q=Roadmap",
      headers: { origin },
      cookies: alice.cookies,
    });
    expect(aiFilter.statusCode).toBe(200);
    expect(
      aiFilter
        .json()
        .items.every(
          (item: { surfaceKind: string }) =>
            item.surfaceKind === "AI_THREAD",
        ),
    ).toBe(true);

    const firstPage = await app.inject({
      method: "GET",
      url: "/v1/inbox?limit=1",
      headers: { origin },
      cookies: alice.cookies,
    });
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json().items).toHaveLength(1);
    expect(firstPage.json().nextCursor).toEqual(
      expect.any(String),
    );

    const secondPage = await app.inject({
      method: "GET",
      url: `/v1/inbox?limit=1&cursor=${encodeURIComponent(firstPage.json().nextCursor)}`,
      headers: { origin },
      cookies: alice.cookies,
    });
    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json().items).toHaveLength(1);
    expect(
      secondPage.json().items[0].surfaceId,
    ).not.toBe(
      firstPage.json().items[0].surfaceId,
    );

    const mismatchedCursor = await app.inject({
      method: "GET",
      url: `/v1/inbox?limit=1&q=Bob&cursor=${encodeURIComponent(firstPage.json().nextCursor)}`,
      headers: { origin },
      cookies: alice.cookies,
    });
    expect(mismatchedCursor.statusCode).toBe(400);

    const markedRead = await app.inject({
      method: "POST",
      url: `/v1/direct-chats/${direct.id}/read`,
      headers: {
        origin,
        "content-type": "application/json",
      },
      cookies: alice.cookies,
      payload: {},
    });
    expect(markedRead.statusCode).toBe(200);

    const afterRead = await app.inject({
      method: "GET",
      url: "/v1/inbox?kind=DIRECT",
      headers: { origin },
      cookies: alice.cookies,
    });
    expect(
      afterRead
        .json()
        .items.find(
          (item: { domainId: string }) =>
            item.domainId === direct.id,
        )?.unreadCount,
    ).toBe(0);
  });
});
