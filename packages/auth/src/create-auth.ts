import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { ApiConfig } from "@vimla/config";
import type { PrismaClient } from "@vimla/database";
import type { Redis } from "ioredis";
import { AUTH_BASE_PATH } from "./user.js";
import { createRedisSecondaryStorage } from "./redis-storage.js";

type VimlaAuthRuntimeConfig = Pick<
  ApiConfig,
  "betterAuthSecret" | "betterAuthUrl" | "webOrigin" | "nodeEnv" | "appEnv"
>;

export interface CreateVimlaAuthOptions {
  prisma: PrismaClient;
  secret: string;
  baseURL: string;
  trustedOrigins: readonly string[];
  useSecureCookies: boolean;
  appEnv: ApiConfig["appEnv"];
  redis?: Redis;
}

export function createVimlaAuth(options: CreateVimlaAuthOptions) {
  const secondaryStorage = options.redis
    ? createRedisSecondaryStorage(options.redis)
    : undefined;

  return betterAuth({
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
      sendResetPassword: async () => {
        // Phase 1: no email delivery. Hook is kept so a provider can be added later.
      },
    },
    emailVerification: {
      sendVerificationEmail: async () => {
        // Phase 1: no email delivery. Local development is not blocked.
      },
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
        "/sign-in/email": {
          window: 10,
          max: 3,
        },
        "/sign-up/email": {
          window: 60,
          max: 5,
        },
      },
    },
    secondaryStorage,
    logger: {
      disabled: false,
      level: "warn",
    },
  });
}

export type VimlaAuth = ReturnType<typeof createVimlaAuth>;

export function createVimlaAuthFromConfig(
  prisma: PrismaClient,
  config: VimlaAuthRuntimeConfig,
  redis?: Redis,
): VimlaAuth {
  return createVimlaAuth({
    prisma,
    secret: config.betterAuthSecret,
    baseURL: config.betterAuthUrl,
    trustedOrigins: [config.webOrigin],
    useSecureCookies:
      config.nodeEnv === "production" || config.appEnv === "production",
    appEnv: config.appEnv,
    redis,
  });
}
