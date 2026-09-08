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
    authOtpDigits: parsed.AUTH_OTP_DIGITS,
    authOtpExpiresSeconds: parsed.AUTH_OTP_EXPIRES_SECONDS,
    authOtpMaxAttempts: parsed.AUTH_OTP_MAX_ATTEMPTS,
    authOtpResendCooldownSeconds: parsed.AUTH_OTP_RESEND_COOLDOWN_SECONDS,
    authResetTokenExpiresSeconds: parsed.AUTH_RESET_TOKEN_EXPIRES_SECONDS,
    authDefaultLocale: parsed.AUTH_DEFAULT_LOCALE,
    authSignupIpLimitPerMinute: parsed.AUTH_SIGNUP_IP_LIMIT_PER_MINUTE,
    authLoginWindowSeconds: parsed.AUTH_LOGIN_WINDOW_SECONDS,
    authLoginMaxAttempts: parsed.AUTH_LOGIN_MAX_ATTEMPTS,
    authOtpSendLimitPerMinute: parsed.AUTH_OTP_SEND_LIMIT_PER_MINUTE,
    authOtpVerifyLimitPerMinute: parsed.AUTH_OTP_VERIFY_LIMIT_PER_MINUTE,
    authPasswordResetLimitPerMinute: parsed.AUTH_PASSWORD_RESET_LIMIT_PER_MINUTE,
    emailProvider: resolveEmailProvider(parsed),
    smtpHost: parsed.SMTP_HOST,
    smtpPort: parsed.SMTP_PORT,
    smtpSecure: parsed.SMTP_SECURE === "true",
    smtpUser: parsed.SMTP_USER,
    smtpPassword: parsed.SMTP_PASSWORD,
    emailFrom: parsed.EMAIL_FROM,
    emailReplyTo: parsed.EMAIL_REPLY_TO,
    smsProvider: resolveSmsProvider(parsed),
    smsHttpUrl: parsed.SMS_HTTP_URL,
    smsHttpAuthorization: parsed.SMS_HTTP_AUTHORIZATION,
    notifyEmailRetryMax: parsed.NOTIFY_EMAIL_RETRY_MAX,
    notifySmsRetryMax: parsed.NOTIFY_SMS_RETRY_MAX,
    notifyEmailPerDestPerHour: parsed.NOTIFY_EMAIL_PER_DEST_PER_HOUR,
    notifyEmailPerIpPerHour: parsed.NOTIFY_EMAIL_PER_IP_PER_HOUR,
    notifyEmailGlobalPerMinute: parsed.NOTIFY_EMAIL_GLOBAL_PER_MINUTE,
    notifySmsPerPhonePerHour: parsed.NOTIFY_SMS_PER_PHONE_PER_HOUR,
    notifySmsPerAccountPerHour: parsed.NOTIFY_SMS_PER_ACCOUNT_PER_HOUR,
    notifySmsPerIpPerHour: parsed.NOTIFY_SMS_PER_IP_PER_HOUR,
    notifySmsGlobalPerMinute: parsed.NOTIFY_SMS_GLOBAL_PER_MINUTE,
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

function resolveEmailProvider(parsed: {
  APP_ENV: string;
  EMAIL_PROVIDER?: "memory" | "smtp";
}): "memory" | "smtp" {
  if (parsed.EMAIL_PROVIDER) {
    return parsed.EMAIL_PROVIDER;
  }

  return parsed.APP_ENV === "local" || parsed.APP_ENV === "test" ? "memory" : "smtp";
}

function resolveSmsProvider(parsed: {
  APP_ENV: string;
  SMS_PROVIDER?: "memory" | "http";
}): "memory" | "http" {
  if (parsed.SMS_PROVIDER) {
    return parsed.SMS_PROVIDER;
  }

  return parsed.APP_ENV === "local" || parsed.APP_ENV === "test" ? "memory" : "http";
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
