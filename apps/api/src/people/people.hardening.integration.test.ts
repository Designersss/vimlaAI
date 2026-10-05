import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
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

function jsonHeaders(): Record<string, string> {
  return {
    origin,
    "content-type": "application/json",
  };
}

describe("people public identity hardening", () => {
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

  it("uses exact, prefix and contains discovery tiers without unbounded one-character scans", async () => {
    const viewer = await registerVerifiedUser(app, "people-short-viewer");
    const target = await registerVerifiedUser(app, "people-short-target");
    const oneCharacter = await registerVerifiedUser(app, "people-short-one", "李");
    const astralExact = await registerVerifiedUser(
      app,
      "people-short-astral-exact",
      "🚀",
    );
    const astralPrefix = await registerVerifiedUser(
      app,
      "people-short-astral-prefix",
    );

    const updated = await app.inject({
      method: "PATCH",
      url: "/v1/people/me",
      headers: jsonHeaders(),
      cookies: target.cookies,
      payload: { displayName: "Никита" },
    });
    expect(updated.statusCode).toBe(200);

    const astralPrefixUpdated = await app.inject({
      method: "PATCH",
      url: "/v1/people/me",
      headers: jsonHeaders(),
      cookies: astralPrefix.cookies,
      payload: { displayName: "🚀 Pilot" },
    });
    expect(astralPrefixUpdated.statusCode).toBe(200);

    const unicodeBoundary = await app.inject({
      method: "PATCH",
      url: "/v1/people/me",
      headers: jsonHeaders(),
      cookies: astralExact.cookies,
      payload: { displayName: "🚀".repeat(80) },
    });
    expect(unicodeBoundary.statusCode).toBe(200);

    const astralExactReset = await app.inject({
      method: "PATCH",
      url: "/v1/people/me",
      headers: jsonHeaders(),
      cookies: astralExact.cookies,
      payload: { displayName: "🚀" },
    });
    expect(astralExactReset.statusCode).toBe(200);

    const oneCharacterPrefix = await app.inject({
      method: "GET",
      url: `/v1/people?q=${encodeURIComponent("Н")}&limit=10`,
      headers: { origin },
      cookies: viewer.cookies,
    });
    expect(oneCharacterPrefix.statusCode).toBe(200);
    expect(oneCharacterPrefix.json().items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: target.id }),
      ]),
    );

    const indexedPrefix = await app.inject({
      method: "GET",
      url: `/v1/people?q=${encodeURIComponent("Ни")}&limit=10`,
      headers: { origin },
      cookies: viewer.cookies,
    });
    expect(indexedPrefix.statusCode).toBe(200);
    expect(indexedPrefix.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: target.id }),
      ]),
    );

    const contains = await app.inject({
      method: "GET",
      url: `/v1/people?q=${encodeURIComponent("кит")}&limit=10`,
      headers: { origin },
      cookies: viewer.cookies,
    });
    expect(contains.statusCode).toBe(200);
    expect(contains.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: target.id }),
      ]),
    );

    const exactShortName = await app.inject({
      method: "GET",
      url: `/v1/people?q=${encodeURIComponent("李")}&limit=10`,
      headers: { origin },
      cookies: viewer.cookies,
    });
    expect(exactShortName.statusCode).toBe(200);
    expect(exactShortName.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: oneCharacter.id }),
      ]),
    );

    const exactAstralName = await app.inject({
      method: "GET",
      url: `/v1/people?q=${encodeURIComponent("🚀")}&limit=10`,
      headers: { origin },
      cookies: viewer.cookies,
    });
    expect(exactAstralName.statusCode).toBe(200);
    expect(exactAstralName.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: astralExact.id }),
      ]),
    );
    expect(exactAstralName.json().items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: astralPrefix.id }),
      ]),
    );
  });

  it("rejects NUL before public profile text reaches PostgreSQL", async () => {
    const owner = await registerVerifiedUser(app, "people-nul-owner");

    for (const payload of [
      { displayName: "Nik\0ita" },
      { bio: "bio\0text" },
      { status: "on\0line" },
    ]) {
      const response = await app.inject({
        method: "PATCH",
        url: "/v1/people/me",
        headers: jsonHeaders(),
        cookies: owner.cookies,
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
  });
});
