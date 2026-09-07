import { z } from "zod";

export const nodeEnvSchema = z.enum(["development", "test", "production"]);
export type NodeEnv = z.infer<typeof nodeEnvSchema>;

export const appEnvSchema = z.enum(["local", "test", "staging", "production"]);
export type AppEnv = z.infer<typeof appEnvSchema>;

export const logLevelSchema = z.enum([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
]);
export type LogLevel = z.infer<typeof logLevelSchema>;

const portSchema = z.coerce.number().int().min(1).max(65535);
const integerStringSchema = z.string().regex(/^\d+$/);

const LOCAL_AUTH_SECRET_MARKERS = ["local-dev-only", "change-me"] as const;

export const publicWebEnvSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.url(),
});
export type PublicWebEnv = z.infer<typeof publicWebEnvSchema>;

export const publicWebConfigSchema = z.object({
  apiBaseUrl: z.url(),
});
export type PublicWebConfig = z.infer<typeof publicWebConfigSchema>;

export const apiEnvSchema = z
  .object({
    NODE_ENV: nodeEnvSchema.default("development"),
    APP_ENV: appEnvSchema.default("local"),
    LOG_LEVEL: logLevelSchema.default("info"),
    API_HOST: z.string().min(1).default("0.0.0.0"),
    API_PORT: portSchema.default(3001),
    WEB_ORIGIN: z.url().default("http://localhost:3000"),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    BILLING_MIN_TOPUP_MICRORUB: integerStringSchema.default("100000000"),
    BILLING_MAX_TOPUP_MICRORUB: integerStringSchema.default("100000000000"),
    BILLING_TOPUP_RATIO_BPS: integerStringSchema.default("3500"),
    BILLING_SUBSCRIPTION_PERIOD_DAYS: z.coerce.number().int().min(1).max(366).default(30),
    PROXYAPI_API_KEY: z.string().optional(),
    PROXYAPI_BASE_URL: z.url().default("https://api.proxyapi.ru/v1"),
    AI_TEXT_ENABLED: z.enum(["true", "false"]).default("true"),
    AI_TEXT_PROVIDER: z.enum(["auto", "mock", "proxyapi"]).default("auto"),
    AI_DEFAULT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(128_000).default(2048),
    AI_MAX_MESSAGE_BYTES: z.coerce.number().int().min(1).default(16_384),
    AI_MAX_CONTEXT_BYTES: z.coerce.number().int().min(1).default(65_536),
    AI_RESERVATION_SAFETY_BPS: z.coerce.number().int().min(0).max(10_000).default(2000),
    AI_MAX_RESERVATION_MICRORUB: integerStringSchema.default("10000000"),
    AI_MAX_CONCURRENT_TEXT_REQUESTS_PER_USER: z.coerce.number().int().min(1).max(32).default(2),
    AI_TEXT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),
    AI_TEXT_IP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(60),
    AI_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600_000).default(120_000),
  })
  .superRefine((value, ctx) => {
    if (value.APP_ENV === "production" || value.APP_ENV === "staging") {
      const secret = value.BETTER_AUTH_SECRET.toLowerCase();
      if (LOCAL_AUTH_SECRET_MARKERS.some((marker) => secret.includes(marker))) {
        ctx.addIssue({
          code: "custom",
          path: ["BETTER_AUTH_SECRET"],
          message:
            "BETTER_AUTH_SECRET must be a unique production secret, not a local example value",
        });
      }

      if (value.AI_TEXT_ENABLED === "true") {
        if (!value.PROXYAPI_API_KEY || value.PROXYAPI_API_KEY.trim().length === 0) {
          ctx.addIssue({
            code: "custom",
            path: ["PROXYAPI_API_KEY"],
            message: "PROXYAPI_API_KEY is required when AI is enabled in staging/production",
          });
        }
        if (value.AI_TEXT_PROVIDER === "mock") {
          ctx.addIssue({
            code: "custom",
            path: ["AI_TEXT_PROVIDER"],
            message: "Mock AI provider is not allowed in staging/production",
          });
        }
      }
    }
  });
export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const apiConfigSchema = z.object({
  nodeEnv: nodeEnvSchema,
  appEnv: appEnvSchema,
  logLevel: logLevelSchema,
  host: z.string().min(1),
  port: portSchema,
  webOrigin: z.url(),
  databaseUrl: z.url(),
  redisUrl: z.url(),
  betterAuthSecret: z.string().min(32),
  betterAuthUrl: z.url(),
  billingMinTopupMicroRub: z.string().regex(/^\d+$/),
  billingMaxTopupMicroRub: z.string().regex(/^\d+$/),
  billingTopupRatioBps: z.string().regex(/^\d+$/),
  billingSubscriptionPeriodDays: z.number().int().min(1).max(366),
  proxyapiApiKey: z.string().min(1).optional(),
  proxyapiBaseUrl: z.url(),
  aiTextEnabled: z.boolean(),
  aiTextProvider: z.enum(["mock", "proxyapi"]),
  aiDefaultMaxOutputTokens: z.number().int().min(1),
  aiMaxMessageBytes: z.number().int().min(1),
  aiMaxContextBytes: z.number().int().min(1),
  aiReservationSafetyBps: z.number().int().min(0).max(10_000),
  aiMaxReservationMicroRub: z.string().regex(/^\d+$/),
  aiMaxConcurrentTextRequestsPerUser: z.number().int().min(1),
  aiTextRateLimitPerMinute: z.number().int().min(1),
  aiTextIpRateLimitPerMinute: z.number().int().min(1),
  aiProviderTimeoutMs: z.number().int().min(1000),
});
export type ApiConfig = z.infer<typeof apiConfigSchema>;

export const workerEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema.default("development"),
  APP_ENV: appEnvSchema.default("local"),
  LOG_LEVEL: logLevelSchema.default("info"),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
});
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export const workerConfigSchema = z.object({
  nodeEnv: nodeEnvSchema,
  appEnv: appEnvSchema,
  logLevel: logLevelSchema,
  databaseUrl: z.url(),
  redisUrl: z.url(),
});
export type WorkerConfig = z.infer<typeof workerConfigSchema>;
