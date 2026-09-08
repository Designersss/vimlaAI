import { betterAuth, type BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { emailOTP, phoneNumber, twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import type { ApiConfig } from "@vimla/config";
import type { PrismaClient } from "@vimla/database";
import { isNotificationAbuseError, type NotificationService } from "@vimla/notifications";
import { DEFAULT_VIMLA_LOCALE, normalizeE164, type VimlaLocale } from "@vimla/shared";
import type { Redis } from "ioredis";
import { hashIdentifier, hashOtp } from "./otp-hash.js";
import { replacePhoneOtpWithHmac, verifyHashedPhoneOtp } from "./phone-otp.js";
import { claimResendSlot, resendCooldownKey } from "./resend-cooldown.js";
import { createRedisSecondaryStorage } from "./redis-storage.js";
import { buildTrustedPasswordResetUrl } from "./reset-url.js";
import { AUTH_BASE_PATH } from "./user.js";

type VimlaAuthRuntimeConfig = Pick<
  ApiConfig,
  | "betterAuthSecret"
  | "betterAuthUrl"
  | "webOrigin"
  | "adminOrigin"
  | "adminWebauthnRpId"
  | "adminWebauthnOrigin"
  | "nodeEnv"
  | "appEnv"
  | "authOtpDigits"
  | "authOtpExpiresSeconds"
  | "authOtpMaxAttempts"
  | "authOtpResendCooldownSeconds"
  | "authResetTokenExpiresSeconds"
  | "authDefaultLocale"
  | "authSignupIpLimitPerMinute"
  | "authLoginWindowSeconds"
  | "authLoginMaxAttempts"
  | "authOtpSendLimitPerMinute"
  | "authOtpVerifyLimitPerMinute"
  | "authPasswordResetLimitPerMinute"
>;

export interface CreateVimlaAuthOptions {
  prisma: PrismaClient;
  secret: string;
  baseURL: string;
  webOrigin: string;
  adminOrigin: string;
  webauthn: {
    rpID: string;
    origin: string;
  };
  trustedOrigins: readonly string[];
  useSecureCookies: boolean;
  appEnv: ApiConfig["appEnv"];
  redis?: Redis;
  notifications: NotificationService;
  defaultLocale: VimlaLocale;
  otp: {
    digits: number;
    expiresSeconds: number;
    maxAttempts: number;
    resendCooldownSeconds: number;
  };
  resetTokenExpiresSeconds: number;
  rateLimits: {
    signupIpPerMinute: number;
    loginWindowSeconds: number;
    loginMaxAttempts: number;
    otpSendPerMinute: number;
    otpVerifyPerMinute: number;
    passwordResetPerMinute: number;
  };
}

export function createVimlaAuth(options: CreateVimlaAuthOptions) {
  const secondaryStorage = options.redis
    ? createRedisSecondaryStorage(options.redis)
    : undefined;

  const authOptions: BetterAuthOptions = {
    appName: "Vimla",
    secret: options.secret,
    baseURL: options.baseURL,
    basePath: AUTH_BASE_PATH,
    trustedOrigins: [...options.trustedOrigins],
    database: prismaAdapter(options.prisma, {
      provider: "postgresql",
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
      resetPasswordTokenExpiresIn: options.resetTokenExpiresSeconds,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        const resetUrl = buildTrustedPasswordResetUrl(options.webOrigin, token);
        options.notifications.queueEmail({
          to: user.email,
          templateId: "passwordReset",
          locale: options.defaultLocale,
          resetUrl,
          budgetConsumed: true,
        });
      },
      onPasswordReset: async ({ user }) => {
        await revokeAdminSessions(options.prisma, user.id);
        options.notifications.queueEmail({
          to: user.email,
          templateId: "securityPasswordChanged",
          locale: options.defaultLocale,
        });
      },
    },
    emailVerification: {
      // Signup OTP is sent by the emailOTP plugin after-hook.
      // Keep this false: enabling it without override would send a magic link,
      // and enabling override disables the plugin's signup OTP after-hook.
      sendOnSignUp: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: false,
      },
    },
    advanced: {
      useSecureCookies: options.useSecureCookies,
      ipAddress: {
        ipAddressHeaders: ["x-forwarded-for", "x-real-ip"],
      },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: options.useSecureCookies,
        path: "/",
      },
    },
    rateLimit: {
      enabled: options.appEnv !== "test",
      window: 60,
      max: 100,
      storage: secondaryStorage ? "secondary-storage" : "memory",
      customRules: {
        // Overrides Better Auth's built-in `/sign-up*` special rule (3 / 10s).
        // Duplicate-email validation is cheap; OTP/SMS/reset stay on their own
        // stricter customRules below.
        "/sign-up*": {
          window: 60,
          max: options.rateLimits.signupIpPerMinute,
        },
        "/sign-up/*": {
          window: 60,
          max: options.rateLimits.signupIpPerMinute,
        },
        "/sign-up/email": {
          window: 60,
          max: options.rateLimits.signupIpPerMinute,
        },
        "/sign-in/email": {
          window: options.rateLimits.loginWindowSeconds,
          max: options.rateLimits.loginMaxAttempts,
        },
        "/two-factor/enable": {
          window: 60,
          max: options.rateLimits.otpVerifyPerMinute,
        },
        "/two-factor/verify-totp": {
          window: 60,
          max: options.rateLimits.otpVerifyPerMinute,
        },
        "/two-factor/verify-backup-code": {
          window: 60,
          max: options.rateLimits.otpVerifyPerMinute,
        },
        "/two-factor/*": {
          window: 60,
          max: options.rateLimits.otpVerifyPerMinute,
        },
        "/passkey/*": {
          window: 60,
          max: options.rateLimits.otpVerifyPerMinute,
        },
        "/request-password-reset": {
          window: 60,
          max: options.rateLimits.passwordResetPerMinute,
        },
        "/forget-password": {
          window: 60,
          max: options.rateLimits.passwordResetPerMinute,
        },
        "/email-otp/send-verification-otp": {
          window: 60,
          max: options.rateLimits.otpSendPerMinute,
        },
        "/email-otp/verify-email": {
          window: 60,
          max: options.rateLimits.otpVerifyPerMinute,
        },
        "/email-otp/request-email-change": {
          window: 60,
          max: options.rateLimits.otpSendPerMinute,
        },
        "/email-otp/change-email": {
          window: 60,
          max: options.rateLimits.otpVerifyPerMinute,
        },
        "/phone-number/send-otp": {
          window: 60,
          max: options.rateLimits.otpSendPerMinute,
        },
        "/phone-number/verify": {
          window: 60,
          max: options.rateLimits.otpVerifyPerMinute,
        },
      },
    },
    secondaryStorage,
    verification: {
      storeInDatabase: true,
    },
    logger: {
      disabled: false,
      level: "warn",
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const body = asMutableBody(ctx.body);
        if (body && (ctx.path === "/forget-password" || ctx.path === "/request-password-reset")) {
          delete body.redirectTo;
          delete body.callbackURL;
        }

        if (ctx.path === "/sign-up/email") {
          if (!body || !("email" in body)) {
            return;
          }

          const existing = await options.prisma.user.findUnique({
            where: { email: String(body.email).toLowerCase() },
            select: { id: true },
          });
          if (existing) {
            throw APIError.from("BAD_REQUEST", {
              message: "Registration could not be completed",
              code: "REGISTRATION_FAILED",
            });
          }
          await consumeDeliveryBudget(options, {
            channel: "email",
            to: String(body.email).toLowerCase(),
            ip: clientIp(ctx),
          });
          return;
        }

        if (ctx.path === "/forget-password" || ctx.path === "/request-password-reset") {
          if (body && "email" in body) {
            await consumeDeliveryBudget(options, {
              channel: "email",
              to: String(body.email).toLowerCase(),
              ip: clientIp(ctx),
            });
          }
          return;
        }

        if (ctx.path === "/email-otp/send-verification-otp") {
          if (!body || !("email" in body)) {
            return;
          }
          const type =
            "type" in body && typeof body.type === "string" ? body.type : "email-verification";
          await enforceOtpResendCooldown(
            options,
            "email",
            `${type}:${String(body.email).toLowerCase()}`,
          );
          await consumeDeliveryBudget(options, {
            channel: "email",
            to: String(body.email).toLowerCase(),
            ip: clientIp(ctx),
          });
          return;
        }

        if (ctx.path === "/email-otp/request-email-change") {
          if (body && "newEmail" in body) {
            await consumeDeliveryBudget(options, {
              channel: "email",
              to: String(body.newEmail).toLowerCase(),
              ip: clientIp(ctx),
            });
          }
          return;
        }

        if (!ctx.path.startsWith("/phone-number")) {
          return;
        }

        if (!body || !("phoneNumber" in body)) {
          return;
        }

        const canonical = normalizeE164(String(body.phoneNumber));
        if (!canonical) {
          throw APIError.from("BAD_REQUEST", {
            message: "Invalid phone number",
            code: "INVALID_PHONE_NUMBER",
          });
        }

        body.phoneNumber = canonical;

        if (ctx.path === "/phone-number/send-otp") {
          await enforceOtpResendCooldown(options, "phone", canonical);
          const session = await getSessionFromCtx(ctx).catch(() => null);
          await consumeDeliveryBudget(options, {
            channel: "sms",
            to: canonical,
            ip: clientIp(ctx),
            userId: session?.user.id,
          });
        }

        if ("updatePhoneNumber" in body && body.updatePhoneNumber === true) {
          const session = await getSessionFromCtx(ctx);
          if (!session) {
            throw APIError.from("UNAUTHORIZED", {
              message: "Authentication required",
              code: "UNAUTHORIZED",
            });
          }
          if (session.user.emailVerified !== true) {
            throw APIError.from("FORBIDDEN", {
              message: "Email is not verified",
              code: "EMAIL_NOT_VERIFIED",
            });
          }
        }

        if (ctx.path === "/phone-number/verify") {
          const updatePhoneNumber =
            "updatePhoneNumber" in body && body.updatePhoneNumber === true;
          if (updatePhoneNumber) {
            return;
          }

          const user = await options.prisma.user.findFirst({
            where: { phoneNumber: canonical, phoneNumberVerified: true },
          });
          if (!user) {
            throw APIError.from("BAD_REQUEST", {
              message: "Invalid OTP",
              code: "INVALID_OTP",
            });
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/change-password") {
          const session = await getSessionFromCtx(ctx).catch(() => null);
          if (session) {
            await revokeAdminSessions(options.prisma, session.user.id);
          }
        }
        if (
          ctx.path === "/two-factor/verify-totp" ||
          ctx.path === "/two-factor/enable" ||
          ctx.path === "/passkey/verify-registration"
        ) {
          const session = await getSessionFromCtx(ctx).catch(() => null);
          if (session) {
            await auditAdminSecurityAction(options.prisma, {
              userId: session.user.id,
              action:
                ctx.path === "/passkey/verify-registration"
                  ? "ADMIN_PASSKEY_ADDED"
                  : "ADMIN_MFA_ENROLLED",
              resourceType: ctx.path === "/passkey/verify-registration" ? "Passkey" : "TwoFactor",
            });
          }
        }
        if (!ctx.path.startsWith("/sign-up")) {
          return;
        }
        const body = ctx.body;
        if (body === null || typeof body !== "object" || !("email" in body)) {
          return;
        }
        await enforceOtpResendCooldown(
          options,
          "email",
          `email-verification:${String(body.email).toLowerCase()}`,
        );
      }),
    },
    plugins: [
      emailOTP({
        otpLength: options.otp.digits,
        expiresIn: options.otp.expiresSeconds,
        allowedAttempts: options.otp.maxAttempts,
        sendVerificationOnSignUp: true,
        // Must stay false. Better Auth skips the signup OTP after-hook when
        // overrideDefaultEmailVerification is true, which left new users without a code.
        overrideDefaultEmailVerification: false,
        disableSignUp: true,
        resendStrategy: "rotate",
        storeOTP: {
          hash: async (otp) => hashOtp(options.secret, otp, "email"),
        },
        changeEmail: {
          enabled: true,
          verifyCurrentEmail: true,
        },
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type === "forget-password" || type === "sign-in") {
            return;
          }

          options.notifications.queueEmail({
            to: email,
            templateId: type === "change-email" ? "changeEmailOtp" : "emailVerificationOtp",
            locale: options.defaultLocale,
            otp,
            budgetConsumed: true,
          });
        },
      }),
      phoneNumber({
        otpLength: options.otp.digits,
        expiresIn: options.otp.expiresSeconds,
        allowedAttempts: options.otp.maxAttempts,
        phoneNumberValidator: async (value) => normalizeE164(value) !== null,
        sendOTP: async ({ phoneNumber: rawPhone, code }, ctx) => {
          const canonical = normalizeE164(rawPhone) ?? rawPhone;
          await replacePhoneOtpWithHmac({
            prisma: options.prisma,
            redis: options.redis,
            identifier: rawPhone,
            otp: code,
            secret: options.secret,
          });

          const session = ctx
            ? await getSessionFromCtx(ctx).catch(() => null)
            : null;
          const linked = await options.prisma.user.findFirst({
            where: { phoneNumber: canonical, phoneNumberVerified: true },
            select: { id: true },
          });

          const isLinking =
            session?.user.emailVerified === true &&
            (!linked || linked.id === session.user.id);
          const isPhoneLogin = Boolean(linked) && !session;

          if (!isLinking && !isPhoneLogin) {
            return;
          }

          options.notifications.queueSms({
            to: canonical,
            templateId: "phoneVerificationOtp",
            locale: options.defaultLocale,
            otp: code,
            budgetConsumed: true,
          });
        },
        verifyOTP: async ({ phoneNumber: rawPhone, code }) => {
          return verifyHashedPhoneOtp({
            prisma: options.prisma,
            identifier: rawPhone,
            otp: code,
            secret: options.secret,
            maxAttempts: options.otp.maxAttempts,
          });
        },
      }),
      twoFactor({
        issuer: "Vimla",
        skipVerificationOnEnable: false,
        backupCodeOptions: {
          storeBackupCodes: "encrypted",
        },
      }),
      passkey({
        rpID: options.webauthn.rpID,
        rpName: "Vimla Admin",
        origin: [options.webauthn.origin, options.webOrigin],
      }),
    ],
  };

  return betterAuth(authOptions);
}

async function enforceOtpResendCooldown(
  options: CreateVimlaAuthOptions,
  kind: "email" | "phone",
  subject: string,
): Promise<void> {
  const allowed = await claimResendSlot({
    redis: options.redis,
    key: resendCooldownKey(hashIdentifier(options.secret, kind, subject)),
    cooldownSeconds: options.otp.resendCooldownSeconds,
  });
  if (!allowed) {
    throw APIError.from("TOO_MANY_REQUESTS", {
      message: "OTP resend is rate limited",
      code: "OTP_RESEND_TOO_SOON",
    });
  }
}

async function consumeDeliveryBudget(
  options: CreateVimlaAuthOptions,
  input: { channel: "email" | "sms"; to: string; ip: string; userId?: string },
): Promise<void> {
  try {
    await options.notifications.consumeBudget(input);
  } catch (error: unknown) {
    if (isNotificationAbuseError(error)) {
      throw APIError.from("TOO_MANY_REQUESTS", {
        message: "Too many notification requests",
        code: "TOO_MANY_REQUESTS",
      });
    }
    throw error;
  }
}

function asMutableBody(body: unknown): Record<string, unknown> | null {
  if (body === null || typeof body !== "object") {
    return null;
  }
  return body as Record<string, unknown>;
}

function clientIp(ctx: { headers: unknown; request?: Request }): string {
  const forwarded = readHeader(ctx.headers, "x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  const realIp = readHeader(ctx.headers, "x-real-ip");
  if (realIp) {
    return realIp;
  }
  return "unknown";
}

function readHeader(headers: unknown, name: string): string | undefined {
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  if (headers !== null && typeof headers === "object" && name in headers) {
    const value = (headers as Record<string, unknown>)[name];
    if (typeof value === "string") {
      return value;
    }
    if (Array.isArray(value) && typeof value[0] === "string") {
      return value[0];
    }
  }
  return undefined;
}

async function revokeAdminSessions(prisma: PrismaClient, userId: string): Promise<void> {
  const principal = await prisma.adminPrincipal.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!principal) {
    return;
  }
  await prisma.adminSession.updateMany({
    where: { principalId: principal.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function auditAdminSecurityAction(
  prisma: PrismaClient,
  input: { userId: string; action: string; resourceType: string },
): Promise<void> {
  const principal = await prisma.adminPrincipal.findUnique({
    where: { userId: input.userId },
    select: { id: true },
  });
  if (!principal) {
    return;
  }
  await prisma.adminAuditLog.create({
    data: {
      adminUserId: input.userId,
      principalId: principal.id,
      action: input.action,
      resourceType: input.resourceType,
      afterSnapshot: { enrolled: true },
    },
  });
}

export type VimlaAuth = ReturnType<typeof createVimlaAuth>;

export function createVimlaAuthFromConfig(
  prisma: PrismaClient,
  config: VimlaAuthRuntimeConfig,
  redis: Redis | undefined,
  notifications: NotificationService,
): VimlaAuth {
  return createVimlaAuth({
    prisma,
    secret: config.betterAuthSecret,
    baseURL: config.betterAuthUrl,
    webOrigin: config.webOrigin,
    adminOrigin: config.adminOrigin,
    webauthn: {
      rpID: config.adminWebauthnRpId,
      origin: config.adminWebauthnOrigin,
    },
    trustedOrigins: [config.webOrigin, config.adminOrigin],
    useSecureCookies:
      config.nodeEnv === "production" || config.appEnv === "production",
    appEnv: config.appEnv,
    redis,
    notifications,
    defaultLocale: config.authDefaultLocale ?? DEFAULT_VIMLA_LOCALE,
    otp: {
      digits: config.authOtpDigits,
      expiresSeconds: config.authOtpExpiresSeconds,
      maxAttempts: config.authOtpMaxAttempts,
      resendCooldownSeconds: config.authOtpResendCooldownSeconds,
    },
    resetTokenExpiresSeconds: config.authResetTokenExpiresSeconds,
    rateLimits: {
      signupIpPerMinute: config.authSignupIpLimitPerMinute,
      loginWindowSeconds: config.authLoginWindowSeconds,
      loginMaxAttempts: config.authLoginMaxAttempts,
      otpSendPerMinute: config.authOtpSendLimitPerMinute,
      otpVerifyPerMinute: config.authOtpVerifyLimitPerMinute,
      passwordResetPerMinute: config.authPasswordResetLimitPerMinute,
    },
  });
}
