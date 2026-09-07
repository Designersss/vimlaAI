import { loadEnvFiles } from "./load-env.js";
import {
  apiConfigSchema,
  apiEnvSchema,
  workerConfigSchema,
  workerEnvSchema,
} from "./schemas.js";
import type { ApiConfig, WorkerConfig } from "./schemas.js";

function readEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (env === process.env) {
    loadEnvFiles();
  }

  return env;
}

export function loadApiConfig(
  env: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const parsed = apiEnvSchema.parse(readEnv(env));
  return apiConfigSchema.parse({
    nodeEnv: parsed.NODE_ENV,
    appEnv: parsed.APP_ENV,
    logLevel: parsed.LOG_LEVEL,
    host: parsed.API_HOST,
    port: parsed.API_PORT,
    webOrigin: parsed.WEB_ORIGIN,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    betterAuthSecret: parsed.BETTER_AUTH_SECRET,
    betterAuthUrl: parsed.BETTER_AUTH_URL,
    billingMinTopupMicroRub: parsed.BILLING_MIN_TOPUP_MICRORUB,
    billingMaxTopupMicroRub: parsed.BILLING_MAX_TOPUP_MICRORUB,
    billingTopupRatioBps: parsed.BILLING_TOPUP_RATIO_BPS,
    billingSubscriptionPeriodDays: parsed.BILLING_SUBSCRIPTION_PERIOD_DAYS,
    proxyapiApiKey:
      parsed.PROXYAPI_API_KEY && parsed.PROXYAPI_API_KEY.trim().length > 0
        ? parsed.PROXYAPI_API_KEY.trim()
        : undefined,
    proxyapiBaseUrl: parsed.PROXYAPI_BASE_URL.replace(/\/$/, ""),
    aiTextEnabled: parsed.AI_TEXT_ENABLED === "true",
    aiTextProvider: resolveAiTextProvider(parsed),
    aiDefaultMaxOutputTokens: parsed.AI_DEFAULT_MAX_OUTPUT_TOKENS,
    aiMaxMessageBytes: parsed.AI_MAX_MESSAGE_BYTES,
    aiMaxContextBytes: parsed.AI_MAX_CONTEXT_BYTES,
    aiReservationSafetyBps: parsed.AI_RESERVATION_SAFETY_BPS,
    aiMaxReservationMicroRub: parsed.AI_MAX_RESERVATION_MICRORUB,
    aiMaxConcurrentTextRequestsPerUser: parsed.AI_MAX_CONCURRENT_TEXT_REQUESTS_PER_USER,
    aiTextRateLimitPerMinute: parsed.AI_TEXT_RATE_LIMIT_PER_MINUTE,
    aiTextIpRateLimitPerMinute: parsed.AI_TEXT_IP_RATE_LIMIT_PER_MINUTE,
    aiProviderTimeoutMs: parsed.AI_PROVIDER_TIMEOUT_MS,
  });
}

function resolveAiTextProvider(parsed: {
  APP_ENV: string;
  AI_TEXT_PROVIDER: "auto" | "mock" | "proxyapi";
  PROXYAPI_API_KEY?: string;
}): "mock" | "proxyapi" {
  if (parsed.AI_TEXT_PROVIDER === "mock" || parsed.AI_TEXT_PROVIDER === "proxyapi") {
    return parsed.AI_TEXT_PROVIDER;
  }

  if (parsed.APP_ENV === "test") {
    return "mock";
  }

  return parsed.PROXYAPI_API_KEY && parsed.PROXYAPI_API_KEY.trim().length > 0
    ? "proxyapi"
    : "mock";
}

export function loadWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  const parsed = workerEnvSchema.parse(readEnv(env));
  return workerConfigSchema.parse({
    nodeEnv: parsed.NODE_ENV,
    appEnv: parsed.APP_ENV,
    logLevel: parsed.LOG_LEVEL,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
  });
}
