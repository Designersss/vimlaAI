import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { loadApiConfig } from "@vimla/config/server";
import { memoryNotificationInbox } from "@vimla/notifications";
import { createVimlaApiApp } from "../create-app.js";
import { PrismaService } from "../persistence/prisma.service.js";
import {
  cookiesFromResponse,
  registerUnverifiedUser,
  registerVerifiedUser,
  verifyEmailOtp,
  waitForEmailOtp,
  waitForPasswordResetUrl,
  withTestRedis,
  clearOtpResendCooldown,
} from "../test/identity-helpers.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const origin = "http://localhost:3000";

function assertNoSecrets(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toMatch(/passwordHash/i);
  expect(serialized).not.toContain('"password"');
  expect(serialized).not.toContain("sessionToken");
  expect(serialized).not.toMatch(/"otp":\s*"\d{6}"/);
}

describe("identity integration", () => {
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
    process.env.AUTH_OTP_RESEND_COOLDOWN_SECONDS = "60";
    process.env.AI_TEXT_ENABLED = "true";
    process.env.AI_TEXT_PROVIDER = "mock";

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

  it("creates an unverified user and blocks AI until OTP verification", async () => {
    const user = await registerUnverifiedUser(app, "unverified-ai");
    const conversation = await app.inject({
      method: "POST",
      url: "/v1/conversations",
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: {},
    });
    expect(conversation.statusCode).toBe(403);
    expect(JSON.stringify(conversation.json())).toContain("email_not_verified");

    const send = await app.inject({
      method: "POST",
      url: `/v1/conversations/${randomUUID()}/messages`,
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: {
        clientRequestId: randomUUID(),
        modelId: "any",
        content: "Hello",
      },
    });
    expect(send.statusCode).toBe(403);
    expect(JSON.stringify(send.json())).toContain("email_not_verified");
    assertNoSecrets(send.json());

    const otp = await waitForEmailOtp(user.email);
    const stored = await app.get(PrismaService).client.verification.findMany({
      where: { identifier: `email-verification-otp-${user.email}` },
    });
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.some((row) => row.value.startsWith(`${otp}:`))).toBe(false);

    await verifyEmailOtp(app, user.email, user.cookies);
  });

  it("rejects wrong, expired and replayed email OTPs and bounds attempts", async () => {
    const user = await registerUnverifiedUser(app, "otp-policy");
    const otp = await waitForEmailOtp(user.email);

    const wrong = await app.inject({
      method: "POST",
      url: "/api/auth/email-otp/verify-email",
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: { email: user.email, otp: "000000" },
    });
    expect(wrong.statusCode).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(wrong.json())).not.toContain(otp);

    const second = await app.inject({
      method: "POST",
      url: "/api/auth/email-otp/verify-email",
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: { email: user.email, otp: "111111" },
    });
    expect(second.statusCode).toBeGreaterThanOrEqual(400);

    const third = await app.inject({
      method: "POST",
      url: "/api/auth/email-otp/verify-email",
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: { email: user.email, otp: "222222" },
    });
    expect(third.statusCode).toBeGreaterThanOrEqual(400);

    const afterBudget = await app.inject({
      method: "POST",
      url: "/api/auth/email-otp/verify-email",
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: { email: user.email, otp },
    });
    expect(afterBudget.statusCode).toBeGreaterThanOrEqual(400);

    const expiredUser = await registerUnverifiedUser(app, "otp-expired");
    const expiredOtp = await waitForEmailOtp(expiredUser.email);
    const identifier = `email-verification-otp-${expiredUser.email.toLowerCase()}`;
    await app.get(PrismaService).client.verification.updateMany({
      where: { identifier },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await withTestRedis(async (redis) => {
      await redis.del(`verification:${identifier}`);
    });
    const expired = await app.inject({
      method: "POST",
      url: "/api/auth/email-otp/verify-email",
      headers: { origin, "content-type": "application/json" },
      cookies: expiredUser.cookies,
      payload: { email: expiredUser.email, otp: expiredOtp },
    });
    expect(expired.statusCode).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(expired.json())).not.toContain(expiredOtp);
  });

  it("enforces resend cooldown and rejects rotated OTPs", async () => {
    const user = await registerUnverifiedUser(app, "otp-rotate");
    const firstOtp = await waitForEmailOtp(user.email);

    const tooSoon = await app.inject({
      method: "POST",
      url: "/api/auth/email-otp/send-verification-otp",
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: { email: user.email, type: "email-verification" },
    });
    expect(tooSoon.statusCode).toBeGreaterThanOrEqual(400);

    const prisma = app.get(PrismaService).client;
    await prisma.verification.deleteMany({
      where: { identifier: { contains: user.email } },
    });
    memoryNotificationInbox.clear();
    await clearOtpResendCooldown();

    const resend = await app.inject({
      method: "POST",
      url: "/api/auth/email-otp/send-verification-otp",
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: { email: user.email, type: "email-verification" },
    });
    expect(resend.statusCode).toBeGreaterThanOrEqual(200);
    expect(resend.statusCode).toBeLessThan(300);
    const secondOtp = await waitForEmailOtp(user.email);
    expect(secondOtp).not.toBe(firstOtp);

    const oldCode = await app.inject({
      method: "POST",
      url: "/api/auth/email-otp/verify-email",
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: { email: user.email, otp: firstOtp },
    });
    expect(oldCode.statusCode).toBeGreaterThanOrEqual(400);

    const fresh = await app.inject({
      method: "POST",
      url: "/api/auth/email-otp/verify-email",
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: { email: user.email, otp: secondOtp },
    });
    expect(fresh.statusCode).toBeGreaterThanOrEqual(200);
    expect(fresh.statusCode).toBeLessThan(300);
  });

  it("lets an existing unverified Phase 1 account enter verification", async () => {
    const user = await registerUnverifiedUser(app, "legacy");
    const prisma = app.get(PrismaService).client;
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: false },
    });

    const signIn = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin, "content-type": "application/json" },
      payload: { email: user.email, password: user.password },
    });
    expect(signIn.statusCode).toBeGreaterThanOrEqual(200);
    expect(signIn.statusCode).toBeLessThan(300);
    const cookies = {
      ...user.cookies,
      ...cookiesFromResponse(signIn),
    };
    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { origin },
      cookies,
    });
    expect((me.json() as { emailVerified: boolean }).emailVerified).toBe(false);

    memoryNotificationInbox.clear();
    await clearOtpResendCooldown();

    const sendOtp = await app.inject({
      method: "POST",
      url: "/api/auth/email-otp/send-verification-otp",
      headers: { origin, "content-type": "application/json" },
      cookies,
      payload: { email: user.email, type: "email-verification" },
    });
    expect(sendOtp.statusCode).toBeGreaterThanOrEqual(200);
    expect(sendOtp.statusCode).toBeLessThan(300);
    await waitForEmailOtp(user.email);
  });

  it("keeps password reset generic and revokes sessions after a valid reset", async () => {
    const user = await registerVerifiedUser(app, "reset");
    const unknown = await app.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      headers: { origin, "content-type": "application/json" },
      payload: {
        email: `missing-${randomUUID()}@example.com`,
        redirectTo: `${origin}/reset-password`,
      },
    });
    const known = await app.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: {
        email: user.email,
        redirectTo: "https://evil.example/phish",
      },
    });
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.json()).toEqual(known.json());
    assertNoSecrets(known.json());

    const resetUrl = await waitForPasswordResetUrl(user.email);
    expect(new URL(resetUrl).origin).toBe(origin);
    expect(resetUrl.startsWith(`${origin}/reset-password?token=`)).toBe(true);
    const token = new URL(resetUrl).searchParams.get("token");
    expect(token).toBeTruthy();
    expect(JSON.stringify(known.json())).not.toContain(token);

    const otherSession = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin, "content-type": "application/json" },
      payload: { email: user.email, password: user.password },
    });
    const otherCookies = cookiesFromResponse(otherSession);

    const reset = await app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      headers: { origin, "content-type": "application/json" },
      payload: { token, newPassword: "new-horse-battery-1" },
    });
    expect(reset.statusCode).toBeGreaterThanOrEqual(200);
    expect(reset.statusCode).toBeLessThan(300);

    const replay = await app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      headers: { origin, "content-type": "application/json" },
      payload: { token, newPassword: "another-horse-battery" },
    });
    expect(replay.statusCode).toBeGreaterThanOrEqual(400);

    const oldPassword = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin, "content-type": "application/json" },
      payload: { email: user.email, password: user.password },
    });
    expect(oldPassword.statusCode).toBeGreaterThanOrEqual(400);

    const oldSession = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { origin },
      cookies: otherCookies,
    });
    expect(oldSession.statusCode).toBe(401);
  });

  it("does not expose phone OTP or SMS login endpoints", async () => {
    const send = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/send-otp",
      headers: { origin, "content-type": "application/json" },
      payload: { phoneNumber: "+79991234567" },
    });
    expect(send.statusCode).toBeGreaterThanOrEqual(400);

    const verify = await app.inject({
      method: "POST",
      url: "/api/auth/phone-number/verify",
      headers: { origin, "content-type": "application/json" },
      payload: { phoneNumber: "+79991234567", code: "123456" },
    });
    expect(verify.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("lists and revokes only the caller's sessions", async () => {
    const userA = await registerVerifiedUser(app, "sess-a");
    const userB = await registerVerifiedUser(app, "sess-b");

    const listA = await app.inject({
      method: "GET",
      url: "/api/auth/list-sessions",
      headers: { origin },
      cookies: userA.cookies,
    });
    expect(listA.statusCode).toBe(200);
    const sessionsA = listA.json() as Array<{ token: string }>;
    expect(sessionsA.length).toBeGreaterThan(0);

    const listB = await app.inject({
      method: "GET",
      url: "/api/auth/list-sessions",
      headers: { origin },
      cookies: userB.cookies,
    });
    const sessionsB = listB.json() as Array<{ token: string }>;
    const foreign = sessionsB[0];
    expect(foreign).toBeDefined();

    const idor = await app.inject({
      method: "POST",
      url: "/api/auth/revoke-session",
      headers: { origin, "content-type": "application/json" },
      cookies: userA.cookies,
      payload: { token: foreign?.token },
    });
    expect(idor.statusCode).toBeLessThan(500);

    const stillB = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { origin },
      cookies: userB.cookies,
    });
    expect(stillB.statusCode).toBe(200);
  });

  it("changes email only after current and new addresses are verified", async () => {
    const user = await registerVerifiedUser(app, "change-email");
    await clearOtpResendCooldown();
    memoryNotificationInbox.clear();

    const sendCurrent = await app.inject({
      method: "POST",
      url: "/api/auth/email-otp/send-verification-otp",
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: { email: user.email, type: "email-verification" },
    });
    expect(sendCurrent.statusCode).toBeGreaterThanOrEqual(200);
    expect(sendCurrent.statusCode).toBeLessThan(300);
    const currentOtp = await waitForEmailOtp(user.email);
    const newEmail = `changed-${randomUUID()}@example.com`;

    const requestChange = await app.inject({
      method: "POST",
      url: "/api/auth/email-otp/request-email-change",
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: { newEmail, otp: currentOtp },
    });
    expect(requestChange.statusCode).toBeGreaterThanOrEqual(200);
    expect(requestChange.statusCode).toBeLessThan(300);

    const newOtp = await waitForEmailOtp(newEmail);
    const change = await app.inject({
      method: "POST",
      url: "/api/auth/email-otp/change-email",
      headers: { origin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: { newEmail, otp: newOtp },
    });
    expect(change.statusCode).toBeGreaterThanOrEqual(200);
    expect(change.statusCode).toBeLessThan(300);

    const cookies = {
      ...user.cookies,
      ...cookiesFromResponse(change),
    };
    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { origin },
      cookies,
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { email: string; emailVerified: boolean }).email).toBe(newEmail);
    expect((me.json() as { emailVerified: boolean }).emailVerified).toBe(true);
  });
});
