import { embeddingEnvShape, embeddingConfigSchema } from "./embeddings.js";
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

export function resolveDefaultPaymentProvider(appEnv: string): "mock" | "tbank" {
  return appEnv === "local" || appEnv === "test" ? "mock" : "tbank";
}

export const publicWebEnvSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.url(),
});
export type PublicWebEnv = z.infer<typeof publicWebEnvSchema>;

export const publicWebConfigSchema = z.object({
  apiBaseUrl: z.url(),
});
export type PublicWebConfig = z.infer<typeof publicWebConfigSchema>;

export const publicAdminEnvSchema = z.object({
  NEXT_PUBLIC_ADMIN_API_BASE_URL: z.url(),
});
export type PublicAdminEnv = z.infer<typeof publicAdminEnvSchema>;

export const publicAdminConfigSchema = z.object({
  apiBaseUrl: z.url(),
});
export type PublicAdminConfig = z.infer<typeof publicAdminConfigSchema>;

export const apiEnvSchema = z
  .object({
    ...embeddingEnvShape,
    NODE_ENV: nodeEnvSchema.default("development"),
    APP_ENV: appEnvSchema.default("local"),
    LOG_LEVEL: logLevelSchema.default("info"),
    API_HOST: z.string().min(1).default("0.0.0.0"),
    API_PORT: portSchema.default(3001),
    WEB_ORIGIN: z.url().default("http://localhost:3000"),
    ADMIN_ORIGIN: z.url().default("http://localhost:3002"),
    ADMIN_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(28_800),
    ADMIN_SESSION_IDLE_SECONDS: z.coerce.number().int().min(60).max(28_800).default(1_800),
    ADMIN_STEP_UP_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
    ADMIN_REQUIRE_TOTP: z.enum(["true", "false"]).default("true"),
    ADMIN_REQUIRE_PASSKEY: z.enum(["true", "false"]).default("false"),
    ADMIN_REPORTING_TIMEZONE: z.string().min(1).default("Europe/Moscow"),
    ADMIN_WEBAUTHN_RP_ID: z.string().min(1).default("localhost"),
    ADMIN_WEBAUTHN_ORIGIN: z.preprocess(emptyToUndefined, z.url().optional()),
    ADMIN_LOGIN_IP_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
    ADMIN_LOGIN_ACCOUNT_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(8),
    ADMIN_LOGIN_GLOBAL_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(30),
    ADMIN_ELEVATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(8),
    ADMIN_QUERY_MAX_RANGE_DAYS: z.coerce.number().int().min(1).max(366).default(366),
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
    SEMANTIC_PLANNER_PROVIDER: z.enum(["auto", "mock", "internal-http"]).default("auto"),
    SEMANTIC_PLANNER_BASE_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    SEMANTIC_PLANNER_MODEL: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional()),
    SEMANTIC_PLANNER_API_KEY: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional()),
    SEMANTIC_PLANNER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(120_000),
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
    NOTIFY_EMAIL_RETRY_MAX: z.coerce.number().int().min(1).max(3).default(2),
    NOTIFY_EMAIL_PER_DEST_PER_HOUR: z.coerce.number().int().min(1).default(8),
    NOTIFY_EMAIL_PER_IP_PER_HOUR: z.coerce.number().int().min(1).default(20),
    NOTIFY_EMAIL_GLOBAL_PER_MINUTE: z.coerce.number().int().min(1).default(40),
    PAYMENT_PROVIDER: z.enum(["mock", "tbank"]).optional(),
    PAYMENT_CHECKOUT_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
    WORKSPACE_MUTATION_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(60),
    OPERATOR_ENABLED: z.enum(["true", "false"]).default("false"),
    OPERATOR_MAX_TOOLS_PER_RUN: z.coerce.number().int().min(1).max(16).default(8),
    OPERATOR_CONFIRMATION_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
    OPERATOR_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),
    PROJECTS_ENABLED: z.enum(["true", "false"]).default("false"),
    PROJECTS_MUTATION_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(60),
    PROJECTS_INVITE_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    MEMORY_ENABLED: z.enum(["true", "false"]).default("false"),
    MEMORY_MUTATION_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(30),
    MEMORY_MAX_ACTIVE_PERSONAL_ITEMS: z.coerce.number().int().min(1).max(10_000).default(1_000),
    MEMORY_MAX_ACTIVE_PROJECT_ITEMS: z.coerce.number().int().min(1).max(20_000).default(2_000),
    MEMORY_DERIVED_AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3_650).optional(),
    DIRECT_CHATS_ENABLED: z.enum(["true", "false"]).default("false"),
    DIRECT_CHATS_MUTATION_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(60),
    DIRECT_CHATS_MAX_CIPHERTEXT_BYTES: z.coerce.number().int().min(1024).max(262_144).default(65_536),
    NOTIFY_INBOX_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(60),
    REMINDER_RECONCILE_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3_600).default(60),
    REMINDER_RECONCILE_BATCH: z.coerce.number().int().min(1).max(500).default(100),
    REMINDER_MAX_LATENESS_MINUTES: z.coerce.number().int().min(5).max(10_080).default(1_440),
    NOTIFY_DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(12).default(6),
    NOTIFY_DELIVERY_BACKOFF_BASE_MS: z.coerce.number().int().min(100).max(600_000).default(5_000),
    NOTIFY_DELIVERY_BACKOFF_CAP_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(300_000),
    NOTIFY_DELIVERY_LEASE_SECONDS: z.coerce.number().int().min(15).max(900).default(120),
    PAYMENT_WEBHOOK_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
    PAYMENT_RECONCILE_AFTER_SECONDS: z.coerce.number().int().min(30).max(86_400).default(120),
    TBANK_ENV: z.enum(["test", "production"]).default("test"),
    TBANK_TERMINAL_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    TBANK_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    TBANK_API_BASE_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    TBANK_NOTIFICATION_BASE_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    TBANK_SUCCESS_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    TBANK_FAIL_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    TBANK_FISCALIZATION_ENABLED: z.enum(["true", "false"]).default("false"),
    TBANK_RECEIPT_TAXATION: z.preprocess(
      emptyToUndefined,
      z.enum(["osn", "usn_income", "usn_income_outcome", "esn", "patent"]).optional(),
    ),
    TBANK_RECEIPT_TAX: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    TBANK_RECEIPT_PAYMENT_METHOD: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    TBANK_RECEIPT_PAYMENT_OBJECT: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    TBANK_RECEIPT_FFD_VERSION: z.preprocess(emptyToUndefined, z.enum(["1.05", "1.2"]).optional()),
    TBANK_RECEIPT_ITEM_NAME: z.preprocess(emptyToUndefined, z.string().min(1).max(128).optional()),
    TBANK_RECURRING_ENABLED: z.enum(["true", "false"]).default("false"),
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

      if (value.SEMANTIC_PLANNER_PROVIDER === "mock") {
        ctx.addIssue({
          code: "custom",
          path: ["SEMANTIC_PLANNER_PROVIDER"],
          message: "Mock semantic planner is not allowed in staging/production",
        });
      }

      if (value.MEMORY_ENABLED === "true") {
        if (
          value.SEMANTIC_PLANNER_PROVIDER === "mock" ||
          !value.SEMANTIC_PLANNER_BASE_URL ||
          !value.SEMANTIC_PLANNER_MODEL
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["MEMORY_ENABLED"],
            message:
              "MEMORY_ENABLED in staging/production requires the configured internal semantic planner",
          });
        }
        if (
          value.MEMORY_DERIVED_AUDIT_RETENTION_DAYS ===
          undefined
        ) {
          ctx.addIssue({
            code: "custom",
            path: [
              "MEMORY_DERIVED_AUDIT_RETENTION_DAYS",
            ],
            message:
              "MEMORY_ENABLED in staging/production requires an explicit derived-audit retention period",
          });
        }
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

      if (!value.ADMIN_ORIGIN.startsWith("https://")) {
        ctx.addIssue({
          code: "custom",
          path: ["ADMIN_ORIGIN"],
          message: "ADMIN_ORIGIN must be an https URL in staging/production",
        });
      }
      if (value.ADMIN_ORIGIN === value.WEB_ORIGIN) {
        ctx.addIssue({
          code: "custom",
          path: ["ADMIN_ORIGIN"],
          message: "ADMIN_ORIGIN must be distinct from WEB_ORIGIN",
        });
      }
      if (value.ADMIN_REQUIRE_PASSKEY !== "true") {
        ctx.addIssue({
          code: "custom",
          path: ["ADMIN_REQUIRE_PASSKEY"],
          message: "ADMIN_REQUIRE_PASSKEY must be true in staging/production",
        });
      }
      const webauthnOrigin = value.ADMIN_WEBAUTHN_ORIGIN ?? value.ADMIN_ORIGIN;
      if (!webauthnOrigin.startsWith("https://")) {
        ctx.addIssue({
          code: "custom",
          path: ["ADMIN_WEBAUTHN_ORIGIN"],
          message: "ADMIN_WEBAUTHN_ORIGIN must be an https URL in staging/production",
        });
      }

      if ((value.PAYMENT_PROVIDER ?? "tbank") === "mock") {
        ctx.addIssue({
          code: "custom",
          path: ["PAYMENT_PROVIDER"],
          message: "Mock payment provider is not allowed in staging/production",
        });
      }
      if (value.APP_ENV === "production" && value.TBANK_ENV !== "production") {
        ctx.addIssue({
          code: "custom",
          path: ["TBANK_ENV"],
          message: "Production requires TBANK_ENV=production",
        });
      }
      if (!value.TBANK_TERMINAL_KEY || LOCAL_AUTH_SECRET_MARKERS.some((marker) => value.TBANK_TERMINAL_KEY?.toLowerCase().includes(marker)) || value.TBANK_TERMINAL_KEY === "MockTerminalKey") {
        ctx.addIssue({
          code: "custom",
          path: ["TBANK_TERMINAL_KEY"],
          message: "TBANK_TERMINAL_KEY must be the real terminal key in staging/production",
        });
      }
      if (!value.TBANK_PASSWORD || LOCAL_AUTH_SECRET_MARKERS.some((marker) => value.TBANK_PASSWORD?.toLowerCase().includes(marker))) {
        ctx.addIssue({
          code: "custom",
          path: ["TBANK_PASSWORD"],
          message: "TBANK_PASSWORD must be the real terminal password in staging/production",
        });
      }
      for (const [path, url] of [
        ["TBANK_NOTIFICATION_BASE_URL", value.TBANK_NOTIFICATION_BASE_URL],
        ["TBANK_SUCCESS_URL", value.TBANK_SUCCESS_URL],
        ["TBANK_FAIL_URL", value.TBANK_FAIL_URL],
      ] as const) {
        if (!url || !url.startsWith("https://")) {
          ctx.addIssue({
            code: "custom",
            path: [path],
            message: `${path} must be an https URL in staging/production`,
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
    }

    if (value.SEMANTIC_PLANNER_PROVIDER === "internal-http") {
      if (!value.SEMANTIC_PLANNER_BASE_URL) {
        ctx.addIssue({
          code: "custom",
          path: ["SEMANTIC_PLANNER_BASE_URL"],
          message: "SEMANTIC_PLANNER_BASE_URL is required when SEMANTIC_PLANNER_PROVIDER=internal-http",
        });
      }
      if (!value.SEMANTIC_PLANNER_MODEL) {
        ctx.addIssue({
          code: "custom",
          path: ["SEMANTIC_PLANNER_MODEL"],
          message: "SEMANTIC_PLANNER_MODEL is required when SEMANTIC_PLANNER_PROVIDER=internal-http",
        });
      }
    }

    if (value.TBANK_RECURRING_ENABLED === "true") {
      ctx.addIssue({
        code: "custom",
        path: ["TBANK_RECURRING_ENABLED"],
        message: "T-Bank recurring charges are not implemented; leave TBANK_RECURRING_ENABLED=false",
      });
    }
    if (value.TBANK_FISCALIZATION_ENABLED === "true") {
      if (!value.TBANK_RECEIPT_TAXATION) {
        ctx.addIssue({
          code: "custom",
          path: ["TBANK_RECEIPT_TAXATION"],
          message: "TBANK_RECEIPT_TAXATION is required when fiscalization is enabled",
        });
      }
      if (!value.TBANK_RECEIPT_TAX) {
        ctx.addIssue({
          code: "custom",
          path: ["TBANK_RECEIPT_TAX"],
          message: "TBANK_RECEIPT_TAX is required when fiscalization is enabled",
        });
      }
      if (!value.TBANK_RECEIPT_PAYMENT_METHOD) {
        ctx.addIssue({
          code: "custom",
          path: ["TBANK_RECEIPT_PAYMENT_METHOD"],
          message: "TBANK_RECEIPT_PAYMENT_METHOD is required when fiscalization is enabled",
        });
      }
      if (!value.TBANK_RECEIPT_PAYMENT_OBJECT) {
        ctx.addIssue({
          code: "custom",
          path: ["TBANK_RECEIPT_PAYMENT_OBJECT"],
          message: "TBANK_RECEIPT_PAYMENT_OBJECT is required when fiscalization is enabled",
        });
      }
      if (!value.TBANK_RECEIPT_FFD_VERSION) {
        ctx.addIssue({
          code: "custom",
          path: ["TBANK_RECEIPT_FFD_VERSION"],
          message: "TBANK_RECEIPT_FFD_VERSION is required when fiscalization is enabled",
        });
      }
    }
    if ((value.PAYMENT_PROVIDER ?? resolveDefaultPaymentProvider(value.APP_ENV)) === "tbank") {
      if (!value.TBANK_TERMINAL_KEY || !value.TBANK_PASSWORD) {
        ctx.addIssue({
          code: "custom",
          path: ["TBANK_PASSWORD"],
          message: "TBANK_TERMINAL_KEY and TBANK_PASSWORD are required when PAYMENT_PROVIDER=tbank",
        });
      }
    }
  });
export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const apiConfigSchema = z.object({
  embeddings: embeddingConfigSchema.optional(),
  nodeEnv: nodeEnvSchema,
  appEnv: appEnvSchema,
  logLevel: logLevelSchema,
  host: z.string().min(1),
  port: portSchema,
  webOrigin: z.url(),
  adminOrigin: z.url(),
  adminSessionTtlSeconds: z.number().int().min(300).max(86_400),
  adminSessionIdleSeconds: z.number().int().min(60).max(28_800),
  adminStepUpSeconds: z.number().int().min(60).max(3_600),
  adminRequireTotp: z.boolean(),
  adminRequirePasskey: z.boolean(),
  adminReportingTimezone: z.string().min(1),
  adminWebauthnRpId: z.string().min(1),
  adminWebauthnOrigin: z.url(),
  adminLoginIpLimitPerMinute: z.number().int().min(1),
  adminLoginAccountLimitPerMinute: z.number().int().min(1),
  adminLoginGlobalLimitPerMinute: z.number().int().min(1),
  adminElevateLimitPerMinute: z.number().int().min(1),
  adminQueryMaxRangeDays: z.number().int().min(1).max(366),
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
  semanticPlannerProvider: z.enum(["disabled", "mock", "internal-http"]),
  semanticPlannerBaseUrl: z.url().optional(),
  semanticPlannerModel: z.string().min(1).optional(),
  semanticPlannerApiKey: z.string().min(1).optional(),
  semanticPlannerTimeoutMs: z.number().int().min(1_000).max(600_000),
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
  notifyEmailRetryMax: z.number().int().min(1).max(3),
  notifyEmailPerDestPerHour: z.number().int().min(1),
  notifyEmailPerIpPerHour: z.number().int().min(1),
  notifyEmailGlobalPerMinute: z.number().int().min(1),
  paymentProvider: z.enum(["mock", "tbank"]),
  paymentCheckoutLimitPerMinute: z.number().int().min(1),
  workspaceMutationLimitPerMinute: z.number().int().min(1),
  operatorEnabled: z.boolean(),
  operatorMaxToolsPerRun: z.number().int().min(1).max(16),
  operatorConfirmationTtlSeconds: z.number().int().min(60).max(3_600),
  operatorRateLimitPerMinute: z.number().int().min(1),
  projectsEnabled: z.boolean(),
  projectsMutationLimitPerMinute: z.number().int().min(1),
  projectsInviteTtlDays: z.number().int().min(1).max(30),
  memoryEnabled: z.boolean(),
  memoryMutationLimitPerMinute: z.number().int().min(1),
  memoryMaxActivePersonalItems: z.number().int().min(1).max(10_000),
  memoryMaxActiveProjectItems: z.number().int().min(1).max(20_000),
  memoryDerivedAuditRetentionDays: z.number().int().min(1).max(3_650),
  directChatsEnabled: z.boolean(),
  directChatsMutationLimitPerMinute: z.number().int().min(1),
  directChatsMaxCiphertextBytes: z.number().int().min(1024).max(262_144),
  notifyInboxLimitPerMinute: z.number().int().min(1),
  reminderReconcileIntervalSeconds: z.number().int().min(15).max(3_600),
  reminderReconcileBatch: z.number().int().min(1).max(500),
  reminderMaxLatenessMinutes: z.number().int().min(5).max(10_080),
  notifyDeliveryMaxAttempts: z.number().int().min(1).max(12),
  notifyDeliveryBackoffBaseMs: z.number().int().min(100).max(600_000),
  notifyDeliveryBackoffCapMs: z.number().int().min(1_000).max(3_600_000),
  notifyDeliveryLeaseSeconds: z.number().int().min(15).max(900),
  paymentWebhookLimitPerMinute: z.number().int().min(1),
  paymentReconcileAfterSeconds: z.number().int().min(30),
  tbankEnv: z.enum(["test", "production"]),
  tbankTerminalKey: z.string().min(1),
  tbankPassword: z.string().min(1),
  tbankApiBaseUrl: z.url(),
  tbankNotificationUrl: z.url(),
  tbankSuccessUrl: z.url(),
  tbankFailUrl: z.url(),
  tbankFiscalizationEnabled: z.boolean(),
  tbankReceiptTaxation: z.string().min(1).optional(),
  tbankReceiptTax: z.string().min(1).optional(),
  tbankReceiptPaymentMethod: z.string().min(1).optional(),
  tbankReceiptPaymentObject: z.string().min(1).optional(),
  tbankReceiptFfdVersion: z.enum(["1.05", "1.2"]).optional(),
  tbankReceiptItemName: z.string().min(1).optional(),
  tbankRecurringEnabled: z.boolean(),
});
export type ApiConfig = z.infer<typeof apiConfigSchema>;

export const workerEnvSchema = z
  .object({
    ...embeddingEnvShape,
    NODE_ENV: nodeEnvSchema.default("development"),
    APP_ENV: appEnvSchema.default("local"),
    LOG_LEVEL: logLevelSchema.default("info"),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    WEB_ORIGIN: z.url().default("http://localhost:3000"),
    BETTER_AUTH_SECRET: z.string().min(32).default("local-dev-only-change-me-use-32-chars-min"),
    AUTH_DEFAULT_LOCALE: z.enum(["ru", "en"]).default("ru"),
    EMAIL_PROVIDER: emailProviderKindSchema.optional(),
    SMTP_HOST: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    SMTP_PORT: portSchema.default(587),
    SMTP_SECURE: z.enum(["true", "false"]).default("false"),
    SMTP_USER: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    SMTP_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    EMAIL_FROM: z.preprocess(emptyToUndefined, z.email().optional()),
    EMAIL_REPLY_TO: z.preprocess(emptyToUndefined, z.email().optional()),
    NOTIFY_EMAIL_RETRY_MAX: z.coerce.number().int().min(1).max(3).default(2),
    NOTIFY_EMAIL_PER_DEST_PER_HOUR: z.coerce.number().int().min(1).default(8),
    NOTIFY_EMAIL_PER_IP_PER_HOUR: z.coerce.number().int().min(1).default(20),
    NOTIFY_EMAIL_GLOBAL_PER_MINUTE: z.coerce.number().int().min(1).default(40),
    REMINDER_RECONCILE_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3_600).default(60),
    REMINDER_RECONCILE_BATCH: z.coerce.number().int().min(1).max(500).default(100),
    REMINDER_MAX_LATENESS_MINUTES: z.coerce.number().int().min(5).max(10_080).default(1_440),
    NOTIFY_DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(12).default(6),
    NOTIFY_DELIVERY_BACKOFF_BASE_MS: z.coerce.number().int().min(100).max(600_000).default(5_000),
    NOTIFY_DELIVERY_BACKOFF_CAP_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(300_000),
    NOTIFY_DELIVERY_LEASE_SECONDS: z.coerce.number().int().min(15).max(900).default(120),
    WORKER_HEALTH_PORT: z.preprocess(emptyToUndefined, portSchema.optional()),
    PAYMENT_PROVIDER: z.enum(["mock", "tbank"]).optional(),
    PAYMENT_RECONCILE_AFTER_SECONDS: z.coerce.number().int().min(30).max(86_400).default(120),
    BILLING_MIN_TOPUP_MICRORUB: integerStringSchema.default("100000000"),
    BILLING_MAX_TOPUP_MICRORUB: integerStringSchema.default("100000000000"),
    BILLING_TOPUP_RATIO_BPS: integerStringSchema.default("3500"),
    BILLING_SUBSCRIPTION_PERIOD_DAYS: z.coerce.number().int().min(1).max(366).default(30),
    AI_DEFAULT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(128_000).default(2048),
    AI_OUTPUT_SHORT_PREFERRED_TOKENS: z.coerce.number().int().min(1).max(128_000).default(512),
    AI_OUTPUT_SHORT_MIN_TOKENS: z.coerce.number().int().min(1).max(128_000).default(128),
    AI_OUTPUT_STANDARD_PREFERRED_TOKENS: z.coerce.number().int().min(1).max(128_000).default(2048),
    AI_OUTPUT_STANDARD_MIN_TOKENS: z.coerce.number().int().min(1).max(128_000).default(768),
    AI_OUTPUT_LONG_PREFERRED_TOKENS: z.coerce.number().int().min(1).max(128_000).default(4096),
    AI_OUTPUT_LONG_MIN_TOKENS: z.coerce.number().int().min(1).max(128_000).default(2048),
    AI_RESERVATION_SAFETY_BPS: z.coerce.number().int().min(0).max(10_000).default(2000),
    AI_MAX_RESERVATION_MICRORUB: integerStringSchema.default("10000000"),
    AI_MAX_PROVIDER_TURNS_PER_INVOCATION: z.coerce.number().int().min(1).max(64).default(8),
    AI_MAX_PAID_INVOCATIONS_PER_PLAN: z.coerce.number().int().min(1).max(256).default(16),
    AI_MAX_PLAN_SETTLED_MICRORUB: integerStringSchema.default("80000000"),
    AI_MAX_PLAN_COMMITTED_MICRORUB: integerStringSchema.default("80000000"),
    AI_CANCELLATION_POLL_MS: z.coerce.number().int().min(10).max(5_000).default(250),
    VIMLA_CORE_PROVIDER: z
      .enum(["auto", "disabled", "deterministic", "internal-http"])
      .default("auto"),
    VIMLA_CORE_BASE_URL: z.preprocess(
      emptyToUndefined,
      z.url().optional(),
    ),
    VIMLA_CORE_MODEL: z.preprocess(
      emptyToUndefined,
      z.string().trim().min(1).optional(),
    ),
    VIMLA_CORE_API_KEY: z.preprocess(
      emptyToUndefined,
      z.string().trim().min(1).optional(),
    ),
    VIMLA_CORE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(600_000)
      .default(60_000),
    VIMLA_CORE_MAX_OUTPUT_TOKENS: z.coerce
      .number()
      .int()
      .min(1)
      .max(32_768)
      .default(2_048),
    VIMLA_CORE_MAX_REQUEST_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(1_048_576)
      .default(262_144),
    VIMLA_CORE_MAX_CONCURRENT_REQUESTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(32)
      .default(4),
    VIMLA_CORE_MAX_QUEUE_DEPTH: z.coerce
      .number()
      .int()
      .min(0)
      .max(1_024)
      .default(32),
    VIMLA_CORE_CIRCUIT_FAILURE_THRESHOLD: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(3),
    VIMLA_CORE_CIRCUIT_RESET_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(600_000)
      .default(30_000),
    VIMLA_CORE_TOOL_USE_ENABLED: z
      .enum(["true", "false"])
      .default("true"),
    VIMLA_CORE_FAIR_USE_REQUESTS_PER_MINUTE: z.coerce
      .number()
      .int()
      .min(1)
      .default(20),
    VIMLA_CORE_FAIR_USE_MAX_CONCURRENT_PER_USER: z.coerce
      .number()
      .int()
      .min(1)
      .max(8)
      .default(2),
    EVALUATOR_PROVIDER: z.enum(["disabled", "internal-http"]).default("disabled"),
    EVALUATOR_BASE_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    EVALUATOR_MODEL: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional()),
    EVALUATOR_API_KEY: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional()),
    EVALUATOR_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(120_000),
    AI_RECONCILIATION_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3_600).default(60),
    AI_RECONCILIATION_BATCH: z.coerce.number().int().min(1).max(500).default(50),
    AI_RECONCILIATION_PRE_PROVIDER_STALE_SECONDS: z.coerce.number().int().min(30).max(86_400).default(300),
    AI_RECONCILIATION_PROVIDER_STALE_SECONDS: z.coerce.number().int().min(30).max(86_400).default(600),
    TBANK_ENV: z.enum(["test", "production"]).default("test"),
    TBANK_TERMINAL_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    TBANK_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    TBANK_API_BASE_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  })
  .superRefine((value, ctx) => {
    if (value.VIMLA_CORE_PROVIDER === "internal-http") {
      if (!value.VIMLA_CORE_BASE_URL) {
        ctx.addIssue({
          code: "custom",
          path: ["VIMLA_CORE_BASE_URL"],
          message:
            "VIMLA_CORE_BASE_URL is required when VIMLA_CORE_PROVIDER=internal-http",
        });
      }
      if (!value.VIMLA_CORE_MODEL) {
        ctx.addIssue({
          code: "custom",
          path: ["VIMLA_CORE_MODEL"],
          message:
            "VIMLA_CORE_MODEL is required when VIMLA_CORE_PROVIDER=internal-http",
        });
      }
    }

    if (
      (value.APP_ENV === "production" || value.APP_ENV === "staging") &&
      value.VIMLA_CORE_PROVIDER === "deterministic"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["VIMLA_CORE_PROVIDER"],
        message:
          "Deterministic Vimla Core provider is not allowed in staging/production",
      });
    }

    if (value.EVALUATOR_PROVIDER === "internal-http") {
      if (!value.EVALUATOR_BASE_URL) {
        ctx.addIssue({
          code: "custom",
          path: ["EVALUATOR_BASE_URL"],
          message: "EVALUATOR_BASE_URL is required when EVALUATOR_PROVIDER=internal-http",
        });
      }
      if (!value.EVALUATOR_MODEL) {
        ctx.addIssue({
          code: "custom",
          path: ["EVALUATOR_MODEL"],
          message: "EVALUATOR_MODEL is required when EVALUATOR_PROVIDER=internal-http",
        });
      }
    }

    if (value.APP_ENV === "production" || value.APP_ENV === "staging") {
      if ((value.PAYMENT_PROVIDER ?? "tbank") === "mock") {
        ctx.addIssue({
          code: "custom",
          path: ["PAYMENT_PROVIDER"],
          message: "Mock payment provider is not allowed in staging/production",
        });
      }
      const secret = value.BETTER_AUTH_SECRET.toLowerCase();
      if (LOCAL_AUTH_SECRET_MARKERS.some((marker) => secret.includes(marker))) {
        ctx.addIssue({
          code: "custom",
          path: ["BETTER_AUTH_SECRET"],
          message:
            "BETTER_AUTH_SECRET must be a unique production secret, not a local example value",
        });
      }
      if (value.EMAIL_PROVIDER !== "smtp") {
        ctx.addIssue({
          code: "custom",
          path: ["EMAIL_PROVIDER"],
          message:
            "EMAIL_PROVIDER must be smtp in staging/production; memory and logging providers are not allowed",
        });
      } else if (!value.SMTP_HOST || !value.SMTP_USER || !value.SMTP_PASSWORD || !value.EMAIL_FROM) {
        ctx.addIssue({
          code: "custom",
          path: ["EMAIL_PROVIDER"],
          message: "SMTP_HOST, SMTP_USER, SMTP_PASSWORD and EMAIL_FROM are required for smtp",
        });
      }
    } else if (value.EMAIL_PROVIDER === "smtp") {
      if (!value.SMTP_HOST || !value.SMTP_USER || !value.SMTP_PASSWORD || !value.EMAIL_FROM) {
        ctx.addIssue({
          code: "custom",
          path: ["EMAIL_PROVIDER"],
          message: "SMTP_HOST, SMTP_USER, SMTP_PASSWORD and EMAIL_FROM are required for smtp",
        });
      }
    }
  });
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export const workerConfigSchema = z.object({
  embeddings: embeddingConfigSchema.optional(),
  nodeEnv: nodeEnvSchema,
  appEnv: appEnvSchema,
  logLevel: logLevelSchema,
  databaseUrl: z.url(),
  redisUrl: z.url(),
  webOrigin: z.url(),
  betterAuthSecret: z.string().min(32),
  authDefaultLocale: z.enum(["ru", "en"]),
  emailProvider: emailProviderKindSchema,
  smtpHost: z.string().min(1).optional(),
  smtpPort: portSchema,
  smtpSecure: z.boolean(),
  smtpUser: z.string().min(1).optional(),
  smtpPassword: z.string().min(1).optional(),
  emailFrom: z.email().optional(),
  emailReplyTo: z.email().optional(),
  notifyEmailRetryMax: z.number().int().min(1).max(3),
  notifyEmailPerDestPerHour: z.number().int().min(1),
  notifyEmailPerIpPerHour: z.number().int().min(1),
  notifyEmailGlobalPerMinute: z.number().int().min(1),
  reminderReconcileIntervalSeconds: z.number().int().min(15).max(3_600),
  reminderReconcileBatch: z.number().int().min(1).max(500),
  reminderMaxLatenessMinutes: z.number().int().min(5).max(10_080),
  notifyDeliveryMaxAttempts: z.number().int().min(1).max(12),
  notifyDeliveryBackoffBaseMs: z.number().int().min(100).max(600_000),
  notifyDeliveryBackoffCapMs: z.number().int().min(1_000).max(3_600_000),
  notifyDeliveryLeaseSeconds: z.number().int().min(15).max(900),
  workerHealthPort: portSchema.optional(),
  paymentProvider: z.enum(["mock", "tbank"]),
  paymentReconcileAfterSeconds: z.number().int().min(30),
  billingMinTopupMicroRub: z.string().regex(/^\d+$/),
  billingMaxTopupMicroRub: z.string().regex(/^\d+$/),
  billingTopupRatioBps: z.string().regex(/^\d+$/),
  billingSubscriptionPeriodDays: z.number().int().min(1).max(366),
  aiDefaultMaxOutputTokens: z.number().int().min(1).max(128_000),
  aiOutputShortPreferredTokens: z.number().int().min(1).max(128_000),
  aiOutputShortMinTokens: z.number().int().min(1).max(128_000),
  aiOutputStandardPreferredTokens: z.number().int().min(1).max(128_000),
  aiOutputStandardMinTokens: z.number().int().min(1).max(128_000),
  aiOutputLongPreferredTokens: z.number().int().min(1).max(128_000),
  aiOutputLongMinTokens: z.number().int().min(1).max(128_000),
  aiReservationSafetyBps: z.number().int().min(0).max(10_000),
  aiMaxReservationMicroRub: z.string().regex(/^\d+$/),
  aiMaxProviderTurnsPerInvocation: z.number().int().min(1).max(64),
  aiMaxPaidInvocationsPerPlan: z.number().int().min(1).max(256),
  aiMaxPlanSettledMicroRub: z.string().regex(/^\d+$/),
  aiMaxPlanCommittedMicroRub: z.string().regex(/^\d+$/),
  aiCancellationPollMs: z.number().int().min(10).max(5_000),
  vimlaCoreProvider: z.enum([
    "disabled",
    "deterministic",
    "internal-http",
  ]),
  vimlaCoreBaseUrl: z.url().optional(),
  vimlaCoreModel: z.string().min(1).optional(),
  vimlaCoreApiKey: z.string().min(1).optional(),
  vimlaCoreTimeoutMs: z.number().int().min(1_000).max(600_000),
  vimlaCoreMaxOutputTokens: z.number().int().min(1).max(32_768),
  vimlaCoreMaxRequestBytes: z.number().int().min(1_024).max(1_048_576),
  vimlaCoreMaxConcurrentRequests: z.number().int().min(1).max(32),
  vimlaCoreMaxQueueDepth: z.number().int().min(0).max(1_024),
  vimlaCoreCircuitFailureThreshold: z.number().int().min(1).max(20),
  vimlaCoreCircuitResetMs: z.number().int().min(1_000).max(600_000),
  vimlaCoreToolUseEnabled: z.boolean(),
  vimlaCoreFairUseRequestsPerMinute: z.number().int().min(1),
  vimlaCoreFairUseMaxConcurrentPerUser: z.number().int().min(1).max(8),
  evaluatorProvider: z.enum(["disabled", "internal-http"]),
  evaluatorBaseUrl: z.url().optional(),
  evaluatorModel: z.string().min(1).optional(),
  evaluatorApiKey: z.string().min(1).optional(),
  evaluatorTimeoutMs: z.number().int().min(1_000).max(600_000),
  aiReconciliationIntervalSeconds: z.number().int().min(15).max(3_600),
  aiReconciliationBatch: z.number().int().min(1).max(500),
  aiReconciliationPreProviderStaleSeconds: z.number().int().min(30).max(86_400),
  aiReconciliationProviderStaleSeconds: z.number().int().min(30).max(86_400),
  tbankEnv: z.enum(["test", "production"]),
  tbankTerminalKey: z.string().min(1),
  tbankPassword: z.string().min(1),
  tbankApiBaseUrl: z.url(),
});
export type WorkerConfig = z.infer<typeof workerConfigSchema>;
