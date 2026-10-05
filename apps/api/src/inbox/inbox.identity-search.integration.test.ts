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

describe("inbox public identity search", () => {
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
    process.env.DIRECT_CHATS_ENABLED = "true";

    const prisma = createPrismaClient(testDatabaseUrl);
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

  it("searches only the actor's Direct Chat peers before applying identity matching", async () => {
    const owner = await registerVerifiedUser(app, "inbox-scope-owner");
    const peer = await registerVerifiedUser(app, "inbox-scope-peer");
    const db = app.get(PrismaService).client;

    await db.publicProfile.update({
      where: { userId: peer.id },
      data: { displayName: "Collision" },
    });
    const createdDirect = await app.inject({
      method: "POST",
      url: "/v1/direct-chats",
      headers: {
        origin,
        "content-type": "application/json",
      },
      cookies: owner.cookies,
      payload: { peerHandle: peer.handle },
    });
    expect(createdDirect.statusCode).toBe(201);
    const directId = (createdDirect.json() as { id: string }).id;

    const runToken = randomUUID().replaceAll("-", "").slice(0, 8);
    const decoys = Array.from({ length: 305 }, (_, index) => {
      const suffix = index.toString().padStart(4, "0");
      const userId = `inbox-decoy-${runToken}-${suffix}`;
      const handle = `a${runToken}${suffix}`;
      return {
        userId,
        handleId: `user:${randomUUID()}`,
        handle,
        email: `${handle}@example.com`,
      };
    });

    try {
      await db.user.createMany({
        data: decoys.map((decoy) => ({
          id: decoy.userId,
          name: "Collision",
          email: decoy.email,
          emailVerified: true,
        })),
      });
      await db.handle.createMany({
        data: decoys.map((decoy) => ({
          id: decoy.handleId,
          handle: decoy.handle,
          normalized: decoy.handle,
          kind: "USER",
          status: "ACTIVE",
          userId: decoy.userId,
        })),
      });
      await db.publicProfile.createMany({
        data: decoys.map((decoy) => ({
          userId: decoy.userId,
          handleId: decoy.handleId,
          displayName: "Collision",
        })),
      });

      const response = await app.inject({
        method: "GET",
        url: `/v1/inbox?kind=DIRECT&q=${encodeURIComponent("Collision")}`,
        headers: { origin },
        cookies: owner.cookies,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            domainId: directId,
            peer: expect.objectContaining({ userId: peer.id }),
          }),
        ]),
      );
    } finally {
      const userIds = decoys.map((decoy) => decoy.userId);
      const handleIds = decoys.map((decoy) => decoy.handleId);
      await db.publicProfile.deleteMany({ where: { userId: { in: userIds } } });
      await db.handle.deleteMany({ where: { id: { in: handleIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });
});
