import { loadEnvFiles } from "./load-env.js";
import {
  apiConfigSchema,
  apiEnvSchema,
  resolveDefaultPaymentProvider,
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
    adminOrigin: parsed.ADMIN_ORIGIN,
    adminSessionTtlSeconds: parsed.ADMIN_SESSION_TTL_SECONDS,
    adminSessionIdleSeconds: parsed.ADMIN_SESSION_IDLE_SECONDS,
    adminStepUpSeconds: parsed.ADMIN_STEP_UP_SECONDS,
    adminRequireTotp: parsed.ADMIN_REQUIRE_TOTP === "true",
    adminRequirePasskey: parsed.ADMIN_REQUIRE_PASSKEY === "true",
    adminReportingTimezone: parsed.ADMIN_REPORTING_TIMEZONE,
    adminWebauthnRpId: parsed.ADMIN_WEBAUTHN_RP_ID,
    adminWebauthnOrigin: (parsed.ADMIN_WEBAUTHN_ORIGIN ?? parsed.ADMIN_ORIGIN).replace(/\/$/, ""),
    adminLoginIpLimitPerMinute: parsed.ADMIN_LOGIN_IP_LIMIT_PER_MINUTE,
    adminLoginAccountLimitPerMinute: parsed.ADMIN_LOGIN_ACCOUNT_LIMIT_PER_MINUTE,
    adminLoginGlobalLimitPerMinute: parsed.ADMIN_LOGIN_GLOBAL_LIMIT_PER_MINUTE,
    adminElevateLimitPerMinute: parsed.ADMIN_ELEVATE_LIMIT_PER_MINUTE,
    adminQueryMaxRangeDays: parsed.ADMIN_QUERY_MAX_RANGE_DAYS,
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
    paymentProvider: parsed.PAYMENT_PROVIDER ?? resolveDefaultPaymentProvider(parsed.APP_ENV),
    paymentCheckoutLimitPerMinute: parsed.PAYMENT_CHECKOUT_LIMIT_PER_MINUTE,
    paymentWebhookLimitPerMinute: parsed.PAYMENT_WEBHOOK_LIMIT_PER_MINUTE,
    paymentReconcileAfterSeconds: parsed.PAYMENT_RECONCILE_AFTER_SECONDS,
    tbankEnv: parsed.TBANK_ENV,
    tbankTerminalKey: parsed.TBANK_TERMINAL_KEY ?? "MockTerminalKey",
    tbankPassword: parsed.TBANK_PASSWORD ?? "local-dev-only-tbank-password",
    tbankApiBaseUrl: resolveTbankApiBaseUrl(parsed.TBANK_ENV, parsed.TBANK_API_BASE_URL),
    tbankNotificationUrl: `${(parsed.TBANK_NOTIFICATION_BASE_URL ?? parsed.BETTER_AUTH_URL).replace(/\/$/, "")}/webhooks/tbank/payments`,
    tbankSuccessUrl: parsed.TBANK_SUCCESS_URL ?? `${parsed.WEB_ORIGIN.replace(/\/$/, "")}/payment/result`,
    tbankFailUrl: parsed.TBANK_FAIL_URL ?? `${parsed.WEB_ORIGIN.replace(/\/$/, "")}/payment/result`,
    tbankFiscalizationEnabled: parsed.TBANK_FISCALIZATION_ENABLED === "true",
    tbankReceiptTaxation: parsed.TBANK_RECEIPT_TAXATION,
    tbankReceiptTax: parsed.TBANK_RECEIPT_TAX,
    tbankReceiptPaymentMethod: parsed.TBANK_RECEIPT_PAYMENT_METHOD,
    tbankReceiptPaymentObject: parsed.TBANK_RECEIPT_PAYMENT_OBJECT,
    tbankReceiptFfdVersion: parsed.TBANK_RECEIPT_FFD_VERSION,
    tbankReceiptItemName: parsed.TBANK_RECEIPT_ITEM_NAME,
    tbankRecurringEnabled: parsed.TBANK_RECURRING_ENABLED === "true",
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

export function resolveTbankApiBaseUrl(
  tbankEnv: "test" | "production",
  override?: string,
): string {
  if (override && override.trim().length > 0) {
    return override.replace(/\/$/, "");
  }
  return tbankEnv === "production"
    ? "https://securepay.tinkoff.ru"
    : "https://rest-api-test.tinkoff.ru";
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
    paymentProvider: parsed.PAYMENT_PROVIDER ?? resolveDefaultPaymentProvider(parsed.APP_ENV),
    paymentReconcileAfterSeconds: parsed.PAYMENT_RECONCILE_AFTER_SECONDS,
    billingMinTopupMicroRub: parsed.BILLING_MIN_TOPUP_MICRORUB,
    billingMaxTopupMicroRub: parsed.BILLING_MAX_TOPUP_MICRORUB,
    billingTopupRatioBps: parsed.BILLING_TOPUP_RATIO_BPS,
    billingSubscriptionPeriodDays: parsed.BILLING_SUBSCRIPTION_PERIOD_DAYS,
    tbankEnv: parsed.TBANK_ENV,
    tbankTerminalKey: parsed.TBANK_TERMINAL_KEY ?? "MockTerminalKey",
    tbankPassword: parsed.TBANK_PASSWORD ?? "local-dev-only-tbank-password",
    tbankApiBaseUrl: resolveTbankApiBaseUrl(parsed.TBANK_ENV, parsed.TBANK_API_BASE_URL),
  });
}
