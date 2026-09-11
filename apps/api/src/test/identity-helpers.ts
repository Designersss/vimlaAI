import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { memoryNotificationInbox } from "@vimla/notifications";
import { Redis } from "ioredis";

const origin = "http://localhost:3000";

export function cookiesFromResponse(response: {
  cookies: Array<{ name: string; value: string }>;
}): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const cookie of response.cookies) {
    cookies[cookie.name] = cookie.value;
  }
  return cookies;
}

export async function registerUnverifiedUser(
  app: NestFastifyApplication,
  label: string,
): Promise<{ cookies: Record<string, string>; id: string; email: string; password: string }> {
  const email = `${label}-${randomUUID()}@example.com`.toLowerCase();
  const password = "correct-horse-battery";
  const signUp = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin, "content-type": "application/json" },
    payload: { email, password, name: label },
  });
  if (signUp.statusCode < 200 || signUp.statusCode >= 300) {
    throw new Error(`sign-up failed: ${signUp.statusCode} ${signUp.body}`);
  }

  const cookies = cookiesFromResponse(signUp);
  const me = await app.inject({
    method: "GET",
    url: "/v1/me",
    headers: { origin },
    cookies,
  });
  if (me.statusCode !== 200) {
    throw new Error(`me after sign-up failed: ${me.statusCode} ${me.body}`);
  }
  const body = me.json() as { id: string; emailVerified: boolean };
  if (body.emailVerified) {
    throw new Error("expected unverified email after sign-up");
  }

  return { cookies, id: body.id, email, password };
}

export async function verifyEmailOtp(
  app: NestFastifyApplication,
  email: string,
  cookies: Record<string, string>,
): Promise<Record<string, string>> {
  const otp = await waitForEmailOtp(email);
  const verify = await app.inject({
    method: "POST",
    url: "/api/auth/email-otp/verify-email",
    headers: { origin, "content-type": "application/json" },
    cookies,
    payload: { email, otp },
  });
  if (verify.statusCode < 200 || verify.statusCode >= 300) {
    throw new Error(`verify-email failed: ${verify.statusCode} ${verify.body}`);
  }

  return {
    ...cookies,
    ...cookiesFromResponse(verify),
  };
}

export async function registerVerifiedUser(
  app: NestFastifyApplication,
  label: string,
): Promise<{ cookies: Record<string, string>; id: string; email: string; password: string }> {
  const created = await registerUnverifiedUser(app, label);
  const cookies = await verifyEmailOtp(app, created.email, created.cookies);
  const me = await app.inject({
    method: "GET",
    url: "/v1/me",
    headers: { origin },
    cookies,
  });
  if (me.statusCode !== 200 || !(me.json() as { emailVerified: boolean }).emailVerified) {
    throw new Error("expected verified email after OTP");
  }
  return { ...created, cookies };
}

export async function waitForEmailOtp(email: string, attempts = 40): Promise<string> {
  for (let index = 0; index < attempts; index += 1) {
    const otp = memoryNotificationInbox.latestOtp("email", email);
    if (otp) {
      return otp;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`OTP was not delivered for ${email}`);
}

export async function waitForPasswordResetUrl(email: string, attempts = 40): Promise<string> {
  for (let index = 0; index < attempts; index += 1) {
    const deliveries = memoryNotificationInbox.all();
    for (let cursor = deliveries.length - 1; cursor >= 0; cursor -= 1) {
      const delivery = deliveries[cursor];
      if (
        delivery &&
        delivery.channel === "email" &&
        delivery.to === email &&
        delivery.templateId === "passwordReset" &&
        delivery.resetUrl
      ) {
        return delivery.resetUrl;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Password reset email was not delivered for ${email}`);
}

export async function withTestRedis<T>(fn: (redis: Redis) => Promise<T>): Promise<T> {
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  try {
    return await fn(redis);
  } finally {
    await redis.quit();
  }
}

export async function clearOtpResendCooldown(): Promise<void> {
  await withTestRedis(async (redis) => {
    const keys = await redis.keys("auth:otp-resend:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });
}
