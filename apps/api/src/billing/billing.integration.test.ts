import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { loadApiConfig } from "@vimla/config/server";
import { createPrismaClient } from "@vimla/database";
import { seedVimlaPlans } from "@vimla/billing";
import { createVimlaApiApp } from "../create-app.js";
import { registerVerifiedUser } from "../test/identity-helpers.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const origin = "http://localhost:3000";

describe("billing HTTP integration", () => {
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

    const prisma = createPrismaClient(testDatabaseUrl);
    await seedVimlaPlans(prisma);
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

  it("keeps plans public and omits provider budget", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/plans" });
    expect(response.statusCode).toBe(200);
    const payload = response.json() as { plans: Array<Record<string, unknown>> };
    expect(payload.plans.length).toBeGreaterThan(0);
    expect(JSON.stringify(payload)).not.toContain("providerBudget");
  });

  it("rejects anonymous usage and subscription requests", async () => {
    const usage = await app.inject({ method: "GET", url: "/v1/usage", headers: { origin } });
    const subscription = await app.inject({
      method: "GET",
      url: "/v1/subscription",
      headers: { origin },
    });
    expect(usage.statusCode).toBe(401);
    expect(subscription.statusCode).toBe(401);
  });

  it("rejects extra userId on financial mutating requests instead of stripping it", async () => {
    const userA = await registerUser(app, "strict-a");
    const userB = await registerUser(app, "strict-b");

    const purchase = await app.inject({
      method: "POST",
      url: "/dev/mock-purchases/subscription",
      headers: { origin, "content-type": "application/json" },
      cookies: userA.cookies,
      payload: { planCode: "PRO", userId: userB.id },
    });
    expect(purchase.statusCode).toBe(400);

    const usageA = await app.inject({
      method: "GET",
      url: "/v1/usage",
      headers: { origin },
      cookies: userA.cookies,
    });
    const usageB = await app.inject({
      method: "GET",
      url: "/v1/usage",
      headers: { origin },
      cookies: userB.cookies,
    });
    expect((usageA.json() as { monthly: { totalMicroRub: string } }).monthly.totalMicroRub).toBe("0");
    expect((usageB.json() as { monthly: { totalMicroRub: string } }).monthly.totalMicroRub).toBe("0");
  });

  it("scopes usage to the authenticated user", async () => {
    const userA = await registerUser(app, "a");
    const userB = await registerUser(app, "b");

    const purchase = await app.inject({
      method: "POST",
      url: "/dev/mock-purchases/subscription",
      headers: { origin, "content-type": "application/json" },
      cookies: userA.cookies,
      payload: { planCode: "PRO" },
    });
    expect(purchase.statusCode).toBe(201);

    const usageA = await app.inject({
      method: "GET",
      url: "/v1/usage",
      headers: { origin },
      cookies: userA.cookies,
    });
    const usageB = await app.inject({
      method: "GET",
      url: "/v1/usage",
      headers: { origin },
      cookies: userB.cookies,
    });

    expect(usageA.statusCode).toBe(200);
    expect(usageB.statusCode).toBe(200);
    const bodyA = usageA.json() as { monthly: { totalMicroRub: string } };
    const bodyB = usageB.json() as { monthly: { totalMicroRub: string } };
    expect(bodyA.monthly.totalMicroRub).toBe("297000000");
    expect(bodyB.monthly.totalMicroRub).toBe("0");

    const subscriptionB = await app.inject({
      method: "GET",
      url: "/v1/subscription",
      headers: { origin },
      cookies: userB.cookies,
    });
    expect(subscriptionB.statusCode).toBe(200);
    expect(subscriptionB.json()).toEqual({ subscription: null });
  });

  it("rejects malformed top-up amounts", async () => {
    const user = await registerUser(app, "top");
    for (const amountMicroRub of ["-100", "0", "not-a-number", "1e30"]) {
      const response = await app.inject({
        method: "POST",
        url: "/dev/mock-purchases/topup",
        headers: { origin, "content-type": "application/json" },
        cookies: user.cookies,
        payload: { amountMicroRub },
      });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    }
  });
});

describe("production mock billing isolation", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "production";
    process.env.LOG_LEVEL = "error";
    process.env.API_HOST = "127.0.0.1";
    process.env.API_PORT = "3001";
    process.env.WEB_ORIGIN = "https://app.vimla.example";
    process.env.ADMIN_ORIGIN = "https://admin.vimla.example";
    process.env.ADMIN_REQUIRE_PASSKEY = "true";
    process.env.ADMIN_WEBAUTHN_RP_ID = "vimla.example";
    process.env.ADMIN_WEBAUTHN_ORIGIN = "https://admin.vimla.example";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
    process.env.BETTER_AUTH_SECRET = "production-secret-value-32-chars-min";
    process.env.BETTER_AUTH_URL = "http://localhost:3001";
    process.env.AI_TEXT_ENABLED = "false";
    process.env.EMAIL_PROVIDER = "smtp";
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "vimla";
    process.env.SMTP_PASSWORD = "smtp-secret-value";
    process.env.EMAIL_FROM = "noreply@vimla.example";
    process.env.SMS_PROVIDER = "http";
    process.env.SMS_HTTP_URL = "https://sms.example.com/send";
    process.env.SMS_HTTP_AUTHORIZATION = "Bearer sms-token";
    process.env.PAYMENT_PROVIDER = "tbank";
    process.env.TBANK_ENV = "production";
    process.env.TBANK_TERMINAL_KEY = "production-terminal-key";
    process.env.TBANK_PASSWORD = "production-tbank-password-value";
    process.env.TBANK_NOTIFICATION_BASE_URL = "https://api.vimla.example";
    process.env.TBANK_SUCCESS_URL = "https://app.vimla.example/payment/result";
    process.env.TBANK_FAIL_URL = "https://app.vimla.example/payment/result";
    process.env.TBANK_FISCALIZATION_ENABLED = "false";

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

  it("does not register mock purchase routes", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/dev/mock-purchases/subscription",
      headers: { origin, "content-type": "application/json" },
      payload: { planCode: "PRO" },
    });
    expect(response.statusCode).toBe(404);
  });
});

async function registerUser(
  app: NestFastifyApplication,
  label: string,
): Promise<{ cookies: Record<string, string>; id: string }> {
  const user = await registerVerifiedUser(app, label);
  return { cookies: user.cookies, id: user.id };
}
