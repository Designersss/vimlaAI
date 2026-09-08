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

function emptyToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

const LOCAL_AUTH_SECRET_MARKERS = ["local-dev-only", "change-me"] as const;

export const emailProviderKindSchema = z.enum(["memory", "smtp"]);
export type EmailProviderKind = z.infer<typeof emailProviderKindSchema>;

export const smsProviderKindSchema = z.enum(["memory", "http"]);
export type SmsProviderKind = z.infer<typeof smsProviderKindSchema>;

const FREE_MAILBOX_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "mail.ru",
  "inbox.ru",
  "list.ru",
  "bk.ru",
  "yandex.ru",
  "yandex.com",
  "proton.me",
  "protonmail.com",
  "icloud.com",
]);

function emailDomain(address: string): string {
  const at = address.lastIndexOf("@");
  return at === -1 ? "" : address.slice(at + 1).toLowerCase();
}

export function isFreeMailboxDomain(address: string): boolean {
  return FREE_MAILBOX_DOMAINS.has(emailDomain(address));
}

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
    AUTH_OTP_DIGITS: z.coerce.number().int().min(4).max(8).default(6),
    AUTH_OTP_EXPIRES_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    AUTH_OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    AUTH_OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(1).max(600).default(60),
    AUTH_RESET_TOKEN_EXPIRES_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),
    AUTH_DEFAULT_LOCALE: z.enum(["ru", "en"]).default("ru"),
    AUTH_SIGNUP_IP_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),
    AUTH_LOGIN_WINDOW_SECONDS: z.coerce.number().int().min(1).default(10),
    AUTH_LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),
    AUTH_OTP_SEND_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(3),
    AUTH_OTP_VERIFY_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(5),
    AUTH_PASSWORD_RESET_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(3),
    EMAIL_PROVIDER: emailProviderKindSchema.optional(),
    SMTP_HOST: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    SMTP_PORT: portSchema.default(587),
    SMTP_SECURE: z.enum(["true", "false"]).default("false"),
    SMTP_USER: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    SMTP_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    EMAIL_FROM: z.preprocess(emptyToUndefined, z.email().optional()),
    EMAIL_REPLY_TO: z.preprocess(emptyToUndefined, z.email().optional()),
    SMS_PROVIDER: smsProviderKindSchema.optional(),
    SMS_HTTP_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    SMS_HTTP_AUTHORIZATION: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    NOTIFY_EMAIL_RETRY_MAX: z.coerce.number().int().min(1).max(3).default(2),
    NOTIFY_SMS_RETRY_MAX: z.coerce.number().int().min(1).max(2).default(1),
    NOTIFY_EMAIL_PER_DEST_PER_HOUR: z.coerce.number().int().min(1).default(8),
    NOTIFY_EMAIL_PER_IP_PER_HOUR: z.coerce.number().int().min(1).default(20),
    NOTIFY_EMAIL_GLOBAL_PER_MINUTE: z.coerce.number().int().min(1).default(40),
    NOTIFY_SMS_PER_PHONE_PER_HOUR: z.coerce.number().int().min(1).default(4),
    NOTIFY_SMS_PER_ACCOUNT_PER_HOUR: z.coerce.number().int().min(1).default(4),
    NOTIFY_SMS_PER_IP_PER_HOUR: z.coerce.number().int().min(1).default(8),
    NOTIFY_SMS_GLOBAL_PER_MINUTE: z.coerce.number().int().min(1).default(20),
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

      if (value.EMAIL_PROVIDER !== "smtp") {
        ctx.addIssue({
          code: "custom",
          path: ["EMAIL_PROVIDER"],
          message:
            "EMAIL_PROVIDER must be smtp in staging/production; memory and logging providers are not allowed",
        });
      } else {
        if (!value.SMTP_HOST) {
          ctx.addIssue({
            code: "custom",
            path: ["SMTP_HOST"],
            message: "SMTP_HOST is required when EMAIL_PROVIDER=smtp",
          });
        }
        if (!value.SMTP_USER) {
          ctx.addIssue({
            code: "custom",
            path: ["SMTP_USER"],
            message: "SMTP_USER is required when EMAIL_PROVIDER=smtp",
          });
        }
        if (!value.SMTP_PASSWORD) {
          ctx.addIssue({
            code: "custom",
            path: ["SMTP_PASSWORD"],
            message: "SMTP_PASSWORD is required when EMAIL_PROVIDER=smtp",
          });
        }
        if (!value.EMAIL_FROM) {
          ctx.addIssue({
            code: "custom",
            path: ["EMAIL_FROM"],
            message: "EMAIL_FROM is required when EMAIL_PROVIDER=smtp",
          });
        } else if (isFreeMailboxDomain(value.EMAIL_FROM)) {
          ctx.addIssue({
            code: "custom",
            path: ["EMAIL_FROM"],
            message:
              "EMAIL_FROM must be a Vimla sender domain, not a consumer free mailbox",
          });
        }
      }

      if (value.SMS_PROVIDER !== "http") {
        ctx.addIssue({
          code: "custom",
          path: ["SMS_PROVIDER"],
          message:
            "SMS_PROVIDER must be http in staging/production; memory and logging providers are not allowed",
        });
      } else {
        if (!value.SMS_HTTP_URL) {
          ctx.addIssue({
            code: "custom",
            path: ["SMS_HTTP_URL"],
            message: "SMS_HTTP_URL is required when SMS_PROVIDER=http",
          });
        }
        if (!value.SMS_HTTP_AUTHORIZATION) {
          ctx.addIssue({
            code: "custom",
            path: ["SMS_HTTP_AUTHORIZATION"],
            message: "SMS_HTTP_AUTHORIZATION is required when SMS_PROVIDER=http",
          });
        }
      }
    } else if (value.EMAIL_PROVIDER === "smtp") {
      if (!value.SMTP_HOST || !value.SMTP_USER || !value.SMTP_PASSWORD || !value.EMAIL_FROM) {
        ctx.addIssue({
          code: "custom",
          path: ["EMAIL_PROVIDER"],
          message: "SMTP_HOST, SMTP_USER, SMTP_PASSWORD and EMAIL_FROM are required for smtp",
        });
      }
    } else if (value.SMS_PROVIDER === "http") {
      if (!value.SMS_HTTP_URL || !value.SMS_HTTP_AUTHORIZATION) {
        ctx.addIssue({
          code: "custom",
          path: ["SMS_PROVIDER"],
          message: "SMS_HTTP_URL and SMS_HTTP_AUTHORIZATION are required for http SMS",
        });
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
  authOtpDigits: z.number().int().min(4).max(8),
  authOtpExpiresSeconds: z.number().int().min(30).max(3600),
  authOtpMaxAttempts: z.number().int().min(1).max(10),
  authOtpResendCooldownSeconds: z.number().int().min(1).max(600),
  authResetTokenExpiresSeconds: z.number().int().min(60).max(86_400),
  authDefaultLocale: z.enum(["ru", "en"]),
  authSignupIpLimitPerMinute: z.number().int().min(1),
  authLoginWindowSeconds: z.number().int().min(1),
  authLoginMaxAttempts: z.number().int().min(1),
  authOtpSendLimitPerMinute: z.number().int().min(1),
  authOtpVerifyLimitPerMinute: z.number().int().min(1),
  authPasswordResetLimitPerMinute: z.number().int().min(1),
  emailProvider: emailProviderKindSchema,
  smtpHost: z.string().min(1).optional(),
  smtpPort: portSchema,
  smtpSecure: z.boolean(),
  smtpUser: z.string().min(1).optional(),
  smtpPassword: z.string().min(1).optional(),
  emailFrom: z.email().optional(),
  emailReplyTo: z.email().optional(),
  smsProvider: smsProviderKindSchema,
  smsHttpUrl: z.url().optional(),
  smsHttpAuthorization: z.string().min(1).optional(),
  notifyEmailRetryMax: z.number().int().min(1).max(3),
  notifySmsRetryMax: z.number().int().min(1).max(2),
  notifyEmailPerDestPerHour: z.number().int().min(1),
  notifyEmailPerIpPerHour: z.number().int().min(1),
  notifyEmailGlobalPerMinute: z.number().int().min(1),
  notifySmsPerPhonePerHour: z.number().int().min(1),
  notifySmsPerAccountPerHour: z.number().int().min(1),
  notifySmsPerIpPerHour: z.number().int().min(1),
  notifySmsGlobalPerMinute: z.number().int().min(1),
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
