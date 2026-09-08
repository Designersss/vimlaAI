import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { loadApiConfig } from "@vimla/config/server";
import { memoryNotificationInbox } from "@vimla/notifications";
import { createVimlaApiApp } from "../create-app.js";
import { waitForEmailOtp } from "../test/identity-helpers.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const origin = "http://localhost:3000";

describe("local signup rate limits and notification inbox", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "local";
    process.env.LOG_LEVEL = "error";
    process.env.API_HOST = "127.0.0.1";
    process.env.API_PORT = "3001";
    process.env.WEB_ORIGIN = origin;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET ?? "local-dev-only-change-me-use-32-chars-min";
    process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
    process.env.EMAIL_PROVIDER = "memory";
    process.env.SMS_PROVIDER = "memory";
    process.env.AUTH_SIGNUP_IP_LIMIT_PER_MINUTE = "20";
    process.env.AI_TEXT_ENABLED = "false";

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

  beforeEach(() => {
    memoryNotificationInbox.clear();
  });

  it("lets a user recover from an existing-email signup and send exactly one OTP", async () => {
    const ip = uniqueIp();
    const existing = `taken-${randomUUID()}@example.com`;
    const first = await signUp(app, existing, ip);
    expect(first.statusCode).toBeGreaterThanOrEqual(200);
    expect(first.statusCode).toBeLessThan(300);
    expect(await waitForEmailOtp(existing)).toHaveLength(6);
    expect(memoryNotificationInbox.all()).toHaveLength(1);

    const duplicate = await signUp(app, existing, ip);
    expect(duplicate.statusCode).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(duplicate.json())).toContain("REGISTRATION_FAILED");
    expect(duplicate.statusCode).not.toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(memoryNotificationInbox.all()).toHaveLength(1);

    const fresh = `fresh-${randomUUID()}@example.com`;
    const created = await signUp(app, fresh, ip);
    expect(created.statusCode).toBeGreaterThanOrEqual(200);
    expect(created.statusCode).toBeLessThan(300);
    expect(await waitForEmailOtp(fresh)).toHaveLength(6);

    const inbox = await app.inject({
      method: "GET",
      url: `/dev/notifications/latest?channel=email&to=${encodeURIComponent(fresh)}`,
    });
    expect(inbox.statusCode).toBe(200);
    const body = inbox.json() as { otp: string | null; templateId: string | null };
    expect(body.otp).toHaveLength(6);
    expect(body.templateId).toBe("emailVerificationOtp");
    expect(
      memoryNotificationInbox.all().filter((item) => item.to === fresh),
    ).toHaveLength(1);
  });

  it("exposes an empty local inbox as notification_not_found, not a missing route", async () => {
    const empty = await app.inject({ method: "GET", url: "/dev/notifications/latest" });
    expect(empty.statusCode).toBe(404);
    expect(empty.json()).toMatchObject({
      error: { code: "notification_not_found" },
    });

    const inboxEmail = `inbox-${randomUUID()}@example.com`;
    await signUp(app, inboxEmail, uniqueIp());
    await waitForEmailOtp(inboxEmail);
    const latest = await app.inject({ method: "GET", url: "/dev/notifications/latest" });
    expect(latest.statusCode).toBe(200);
    const body = latest.json() as { otp: string | null; channel: string | null };
    expect(body.channel).toBe("email");
    expect(body.otp).toHaveLength(6);
  });
});

describe("signup HTTP rate limit", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "local";
    process.env.LOG_LEVEL = "error";
    process.env.API_HOST = "127.0.0.1";
    process.env.API_PORT = "3001";
    process.env.WEB_ORIGIN = origin;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET ?? "local-dev-only-change-me-use-32-chars-min";
    process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
    process.env.EMAIL_PROVIDER = "memory";
    process.env.SMS_PROVIDER = "memory";
    process.env.AUTH_SIGNUP_IP_LIMIT_PER_MINUTE = "2";
    process.env.AI_TEXT_ENABLED = "false";

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

  it("returns HTTP 429 with retryAfter after the signup threshold", async () => {
    const ip = uniqueIp();
    const first = await signUp(app, `limit-a-${randomUUID()}@example.com`, ip);
    const second = await signUp(app, `limit-b-${randomUUID()}@example.com`, ip);
    expect(first.statusCode).toBeGreaterThanOrEqual(200);
    expect(first.statusCode).toBeLessThan(300);
    expect(second.statusCode).toBeGreaterThanOrEqual(200);
    expect(second.statusCode).toBeLessThan(300);
    const blocked = await signUp(app, `limit-c-${randomUUID()}@example.com`, ip);
    expect(blocked.statusCode).toBe(429);
    const retryAfter = blocked.headers["x-retry-after"] ?? blocked.headers["retry-after"];
    expect(retryAfter).toBeDefined();
    expect(JSON.stringify(blocked.json()).toLowerCase()).toMatch(/too many requests/);
  });
});

describe("production notification inbox isolation", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "production";
    process.env.LOG_LEVEL = "error";
    process.env.API_HOST = "127.0.0.1";
    process.env.API_PORT = "3001";
    process.env.WEB_ORIGIN = origin;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
    process.env.BETTER_AUTH_SECRET = "production-secret-value-32-chars-min";
    process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
    process.env.AI_TEXT_ENABLED = "false";
    process.env.EMAIL_PROVIDER = "smtp";
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "vimla";
    process.env.SMTP_PASSWORD = "smtp-secret-value";
    process.env.EMAIL_FROM = "noreply@vimla.example";
    process.env.SMS_PROVIDER = "http";
    process.env.SMS_HTTP_URL = "https://sms.example.com/send";
    process.env.SMS_HTTP_AUTHORIZATION = "Bearer sms-token";

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

  it("does not register the local notification inbox", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/dev/notifications/latest",
    });
    expect(response.statusCode).toBe(404);
    const payload = JSON.stringify(response.json());
    expect(payload).not.toContain("notification_not_found");
    expect(payload).not.toContain("smtp-secret-value");
    expect(payload).not.toContain("sms-token");
  });
});

function uniqueIp(): string {
  return `198.51.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
}

async function signUp(app: NestFastifyApplication, email: string, ip = "127.0.0.1") {
  return app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: {
      origin,
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    payload: {
      email,
      password: "correct-horse-battery",
      name: "Ada",
    },
  });
}
