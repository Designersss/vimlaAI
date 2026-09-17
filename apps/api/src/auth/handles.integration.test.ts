import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createPrismaClient } from "@vimla/database";
import { loadApiConfig } from "@vimla/config/server";
import { currentUserSchema } from "@vimla/contracts";
import { createVimlaApiApp } from "../create-app.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for handle integration tests");
}

const origin = "http://localhost:3000";
const password = "correct-horse-battery";

type CookieJar = Record<string, string>;

function cookiesFromResponse(response: { cookies: Array<{ name: string; value: string }> }): CookieJar {
  return Object.fromEntries(response.cookies.map((cookie) => [cookie.name, cookie.value]));
}

async function signUp(
  app: NestFastifyApplication,
  email: string,
): Promise<CookieJar> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin, "content-type": "application/json" },
    payload: { email, password, name: "Handle Test" },
  });
  expect(response.statusCode).toBeGreaterThanOrEqual(200);
  expect(response.statusCode).toBeLessThan(300);
  return cookiesFromResponse(response);
}

describe("global handle identity", () => {
  let app: NestFastifyApplication;
  const prisma = createPrismaClient(testDatabaseUrl);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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

    app = await createVimlaApiApp(loadApiConfig(process.env), { quiet: true });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (app) await app.close();
  });

  it("keeps system and impersonation handles unavailable", async () => {
    for (const handle of ["vimla", "auto", "chatgpt", "admin"]) {
      const response = await app.inject({
        method: "GET",
        url: `/v1/handles/availability?handle=${handle}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ handle, available: false });
    }
  });

  it("blocks ordinary product APIs until an active handle exists", async () => {
    const email = `handleless-${suffix}@example.com`;
    const cookies = await signUp(app, email);

    const me = await app.inject({ method: "GET", url: "/v1/me", headers: { origin }, cookies });
    expect(me.statusCode).toBe(200);
    const current = currentUserSchema.parse(me.json());
    expect(current.handleRequired).toBe(true);
    expect(current.handle).toBeNull();

    const models = await app.inject({
      method: "GET",
      url: "/v1/ai/models",
      headers: { origin },
      cookies,
    });
    expect(models.statusCode).toBe(403);
    expect(models.json()).toMatchObject({
      error: {
        code: "handle_required",
        message: "Choose a public handle to continue",
      },
    });
  });

  it("allows exactly one concurrent claimant for the same global handle", async () => {
    const firstCookies = await signUp(app, `first-${suffix}@example.com`);
    const secondCookies = await signUp(app, `second-${suffix}@example.com`);
    const handle = `race_${suffix.replaceAll("-", "").slice(-12)}`;

    const request = (cookies: CookieJar) =>
      app.inject({
        method: "POST",
        url: "/v1/handles/claim",
        headers: { origin, "content-type": "application/json" },
        cookies,
        payload: { handle },
      });

    const responses = await Promise.all([request(firstCookies), request(secondCookies)]);
    const statuses = responses.map((response) => response.statusCode).sort((a, b) => a - b);
    expect(statuses[0]).toBeGreaterThanOrEqual(200);
    expect(statuses[0]).toBeLessThan(300);
    expect(statuses[1]).toBe(409);

    const availability = await app.inject({
      method: "GET",
      url: `/v1/handles/availability?handle=${handle}`,
    });
    expect(availability.json()).toEqual({ handle, available: false });
  });

  it("normalizes a claim and activates it after email verification", async () => {
    const email = `activate-${suffix}@example.com`;
    const cookies = await signUp(app, email);
    const handle = `user_${suffix.replaceAll("-", "").slice(-12)}`;

    const claim = await app.inject({
      method: "POST",
      url: "/v1/handles/claim",
      headers: { origin, "content-type": "application/json" },
      cookies,
      payload: { handle: `@${handle.toUpperCase()}` },
    });
    expect(claim.statusCode).toBeGreaterThanOrEqual(200);
    expect(claim.statusCode).toBeLessThan(300);
    expect(claim.json()).toEqual({ handle, status: "PENDING" });

    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });

    const me = await app.inject({ method: "GET", url: "/v1/me", headers: { origin }, cookies });
    expect(me.statusCode).toBe(200);
    const current = currentUserSchema.parse(me.json());
    expect(current.handle).toBe(handle);
    expect(current.handleStatus).toBe("ACTIVE");
    expect(current.handleRequired).toBe(false);

    const models = await app.inject({
      method: "GET",
      url: "/v1/ai/models",
      headers: { origin },
      cookies,
    });
    expect(models.statusCode).not.toBe(403);
  });

  it("does not allow a user to swap an already claimed handle in v1", async () => {
    const email = `immutable-${suffix}@example.com`;
    const cookies = await signUp(app, email);
    const first = `fixed_${suffix.replaceAll("-", "").slice(-10)}`;
    const second = `other_${suffix.replaceAll("-", "").slice(-10)}`;

    const initial = await app.inject({
      method: "POST",
      url: "/v1/handles/claim",
      headers: { origin, "content-type": "application/json" },
      cookies,
      payload: { handle: first },
    });
    expect(initial.statusCode).toBeGreaterThanOrEqual(200);
    expect(initial.statusCode).toBeLessThan(300);

    const change = await app.inject({
      method: "POST",
      url: "/v1/handles/claim",
      headers: { origin, "content-type": "application/json" },
      cookies,
      payload: { handle: second },
    });
    expect(change.statusCode).toBe(409);
  });
});
