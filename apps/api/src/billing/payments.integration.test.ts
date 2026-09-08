import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { loadApiConfig } from "@vimla/config/server";
import { createPrismaClient } from "@vimla/database";
import { seedVimlaPlans, signTBankToken } from "@vimla/billing";
import { createVimlaApiApp } from "../create-app.js";
import { registerUnverifiedUser, registerVerifiedUser } from "../test/identity-helpers.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const origin = "http://localhost:3000";

describe("payment HTTP", () => {
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
    process.env.PAYMENT_PROVIDER = "mock";

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

  it("rejects extra price and userId on checkout", async () => {
    const user = await registerVerifiedUser(app, "pay-tamper");
    const response = await app.inject({
      method: "POST",
      url: "/v1/payments/subscriptions",
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: {
        planCode: "PRO",
        idempotencyKey: randomUUID(),
        price: 1,
        userId: "other",
        providerBudget: 999999,
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects unverified checkout", async () => {
    const user = await registerUnverifiedUser(app, "pay-unverified");
    const response = await app.inject({
      method: "POST",
      url: "/v1/payments/subscriptions",
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: { planCode: "PRO", idempotencyKey: randomUUID() },
    });
    expect(response.statusCode).toBe(403);
  });

  it("returns 404 for a foreign payment", async () => {
    const userA = await registerVerifiedUser(app, "pay-a");
    const userB = await registerVerifiedUser(app, "pay-b");
    const checkout = await app.inject({
      method: "POST",
      url: "/v1/payments/subscriptions",
      headers: { origin, "content-type": "application/json" },
      cookies: userA.cookies,
      payload: { planCode: "PRO", idempotencyKey: randomUUID() },
    });
    expect(checkout.statusCode).toBe(201);
    const paymentId = (checkout.json() as { paymentId: string }).paymentId;
    const foreign = await app.inject({
      method: "GET",
      url: `/v1/payments/${paymentId}`,
      headers: { origin },
      cookies: userB.cookies,
    });
    expect(foreign.statusCode).toBe(404);
  });

  it("does not grant usage from a success redirect; grants once from a verified webhook", async () => {
    const user = await registerVerifiedUser(app, "pay-hook");
    const checkout = await app.inject({
      method: "POST",
      url: "/v1/payments/subscriptions",
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: { planCode: "PRO", idempotencyKey: randomUUID() },
    });
    expect(checkout.statusCode).toBe(201);
    const body = checkout.json() as { paymentId: string; paymentUrl: string };
    expect(body.paymentUrl).toContain("/payment/mock");

    const pending = await app.inject({
      method: "GET",
      url: `/v1/payments/${body.paymentId}`,
      headers: { origin },
      cookies: user.cookies,
    });
    const payment = pending.json() as {
      status: string;
      orderId: string;
      providerPaymentId: string;
      amountMicroRub: string;
    };
    expect(payment.status).toBe("PENDING");

    const usageBefore = await app.inject({
      method: "GET",
      url: "/v1/usage",
      headers: { origin },
      cookies: user.cookies,
    });
    expect((usageBefore.json() as { monthly: { totalMicroRub: string } }).monthly.totalMicroRub).toBe(
      "0",
    );

    const fields = {
      TerminalKey: "MockTerminalKey",
      OrderId: payment.orderId,
      Success: true,
      Status: "CONFIRMED",
      PaymentId: payment.providerPaymentId,
      ErrorCode: "0",
      Amount: 99000,
    };
    const webhook = await app.inject({
      method: "POST",
      url: "/webhooks/tbank/payments",
      headers: { "content-type": "application/json" },
      payload: { ...fields, Token: signTBankToken(fields, "local-dev-only-tbank-password") },
    });
    expect(webhook.statusCode).toBe(200);
    expect(webhook.body).toBe("OK");

    const usageAfter = await app.inject({
      method: "GET",
      url: "/v1/usage",
      headers: { origin },
      cookies: user.cookies,
    });
    expect((usageAfter.json() as { monthly: { totalMicroRub: string } }).monthly.totalMicroRub).toBe(
      "297000000",
    );
  });
});
