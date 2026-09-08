import type { Redis } from "ioredis";
import { APIError } from "better-auth/api";
import { hmacTimingSafeEqualHex } from "@vimla/shared";
import type { PrismaClient } from "@vimla/database";
import { hashOtp } from "./otp-hash.js";

export async function replacePhoneOtpWithHmac(input: {
  prisma: PrismaClient;
  redis?: Redis;
  identifier: string;
  otp: string;
  secret: string;
}): Promise<void> {
  const hashed = hashOtp(input.secret, input.otp, "phone");
  const value = `${hashed}:0`;
  await input.prisma.verification.updateMany({
    where: { identifier: input.identifier },
    data: { value },
  });

  if (!input.redis) {
    return;
  }

  const key = `verification:${input.identifier}`;
  const cached = await input.redis.get(key);
  if (!cached) {
    return;
  }

  try {
    const parsed: unknown = JSON.parse(cached);
    if (parsed !== null && typeof parsed === "object") {
      await input.redis.set(key, JSON.stringify({ ...parsed, value }), "KEEPTTL");
    }
  } catch {
    await input.redis.del(key);
  }
}

export async function verifyHashedPhoneOtp(input: {
  prisma: PrismaClient;
  identifier: string;
  otp: string;
  secret: string;
  maxAttempts: number;
}): Promise<boolean> {
  const existing = await input.prisma.verification.findFirst({
    where: { identifier: input.identifier },
  });

  if (!existing) {
    throw APIError.from("BAD_REQUEST", {
      message: "Invalid OTP",
      code: "INVALID_OTP",
    });
  }

  if (existing.expiresAt < new Date()) {
    await input.prisma.verification.deleteMany({ where: { identifier: input.identifier } });
    throw APIError.from("BAD_REQUEST", {
      message: "OTP expired",
      code: "OTP_EXPIRED",
    });
  }

  const [storedHash, rawAttempts] = existing.value.split(":");
  const attempts = Number.parseInt(rawAttempts ?? "0", 10);
  const safeAttempts = Number.isFinite(attempts) && attempts > 0 ? attempts : 0;

  if (safeAttempts >= input.maxAttempts) {
    await input.prisma.verification.deleteMany({ where: { identifier: input.identifier } });
    throw APIError.from("FORBIDDEN", {
      message: "Too many attempts",
      code: "TOO_MANY_ATTEMPTS",
    });
  }

  const providedHash = hashOtp(input.secret, input.otp, "phone");
  if (!storedHash || !hmacTimingSafeEqualHex(storedHash, providedHash)) {
    const nextAttempts = safeAttempts + 1;
    if (nextAttempts >= input.maxAttempts) {
      await input.prisma.verification.deleteMany({ where: { identifier: input.identifier } });
      throw APIError.from("FORBIDDEN", {
        message: "Too many attempts",
        code: "TOO_MANY_ATTEMPTS",
      });
    }

    await input.prisma.verification.update({
      where: { id: existing.id },
      data: { value: `${storedHash}:${nextAttempts}` },
    });
    throw APIError.from("BAD_REQUEST", {
      message: "Invalid OTP",
      code: "INVALID_OTP",
    });
  }

  return true;
}
