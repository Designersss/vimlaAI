import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { loadApiConfig } from "@vimla/config/server";
import { currentUserSchema } from "@vimla/contracts";
import { createVimlaApiApp } from "../create-app.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required. Start PostgreSQL/Redis and run `pnpm test:integration`.",
  );
}

const origin = "http://localhost:3000";

interface CookieJar {
  [name: string]: string;
}

function cookiesFromResponse(response: {
  cookies: Array<{ name: string; value: string }>;
}): CookieJar {
  const cookies: CookieJar = {};
  for (const cookie of response.cookies) {
    cookies[cookie.name] = cookie.value;
  }
  return cookies;
}

function assertNoSecrets(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toMatch(/passwordHash/i);
  expect(serialized).not.toContain('"password"');
  expect(serialized).not.toContain("sessionToken");
}

describe("authentication integration", () => {
  let app: NestFastifyApplication;
  const email = `ada-${Date.now()}@example.com`;
  const password = "correct-horse-battery";

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
      process.env.BETTER_AUTH_SECRET ??
      "local-dev-only-change-me-use-32-chars-min";
    process.env.BETTER_AUTH_URL =
      process.env.BETTER_AUTH_URL ?? "http://localhost:3001";

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

  it("keeps health public", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });
    expect(response.statusCode).toBeLessThan(500);
  });

  it("rejects anonymous current-user requests", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { origin },
    });

    expect(response.statusCode).toBe(401);
    const payload: unknown = response.json();
    assertNoSecrets(payload);
  });

  it("registers, signs in, reads /v1/me, and signs out", async () => {
    const signUp = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: {
        origin,
        "content-type": "application/json",
      },
      payload: {
        email,
        password,
        name: "Ada Lovelace",
      },
    });

    expect(signUp.statusCode).toBeGreaterThanOrEqual(200);
    expect(signUp.statusCode).toBeLessThan(300);
    const signUpBody: unknown = signUp.json();
    assertNoSecrets(signUpBody);

    const sessionCookies = cookiesFromResponse(signUp);
    expect(Object.keys(sessionCookies).length).toBeGreaterThan(0);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: {
        origin,
        "content-type": "application/json",
      },
      payload: {
        email,
        password,
        name: "Ada Lovelace",
      },
    });
    expect(duplicate.statusCode).toBeGreaterThanOrEqual(400);

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: {
        origin,
        "content-type": "application/json",
      },
      payload: {
        email,
        password: "wrong-password-value",
      },
    });
    expect(wrongPassword.statusCode).toBeGreaterThanOrEqual(400);

    const signIn = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: {
        origin,
        "content-type": "application/json",
      },
      payload: {
        email,
        password,
      },
    });
    expect(signIn.statusCode).toBeGreaterThanOrEqual(200);
    expect(signIn.statusCode).toBeLessThan(300);
    assertNoSecrets(signIn.json());

    const signedInCookies = {
      ...sessionCookies,
      ...cookiesFromResponse(signIn),
    };

    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { origin },
      cookies: signedInCookies,
    });

    expect(me.statusCode).toBe(200);
    const currentUser = currentUserSchema.parse(me.json());
    expect(currentUser.email).toBe(email);
    assertNoSecrets(me.json());

    const signOut = await app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: {
        origin,
        "content-type": "application/json",
      },
      cookies: signedInCookies,
      payload: {},
    });
    expect(signOut.statusCode).toBeGreaterThanOrEqual(200);
    expect(signOut.statusCode).toBeLessThan(300);

    const afterLogout = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { origin },
      cookies: signedInCookies,
    });
    expect(afterLogout.statusCode).toBe(401);
  });
});
