import { describe, expect, it } from "vitest";
import { parsePublicAdminConfig, parsePublicWebConfig } from "./public.js";
import { loadApiConfig, loadWorkerConfig } from "./server.js";

const validSharedEnv = {
  NODE_ENV: "test",
  APP_ENV: "test",
  LOG_LEVEL: "info",
  DATABASE_URL: "postgresql://vimla:vimla@localhost:5432/vimla",
  REDIS_URL: "redis://localhost:6379",
  BETTER_AUTH_SECRET: "local-dev-only-change-me-use-32-chars-min",
  BETTER_AUTH_URL: "http://localhost:3001",
} as const;

const productionPaymentEnv = {
  PAYMENT_PROVIDER: "tbank",
  TBANK_ENV: "production",
  TBANK_TERMINAL_KEY: "production-terminal-key",
  TBANK_PASSWORD: "production-tbank-password-value",
  TBANK_NOTIFICATION_BASE_URL: "https://api.vimla.example",
  TBANK_SUCCESS_URL: "https://app.vimla.example/payment/result",
  TBANK_FAIL_URL: "https://app.vimla.example/payment/result",
  TBANK_FISCALIZATION_ENABLED: "false",
  WEB_ORIGIN: "https://app.vimla.example",
  ADMIN_ORIGIN: "https://admin.vimla.example",
  ADMIN_REQUIRE_PASSKEY: "true",
  ADMIN_WEBAUTHN_RP_ID: "vimla.example",
  ADMIN_WEBAUTHN_ORIGIN: "https://admin.vimla.example",
} as const;

describe("parsePublicWebConfig", () => {
  it("parses and normalizes the API base URL", () => {
    const config = parsePublicWebConfig({
      NEXT_PUBLIC_API_BASE_URL: "http://localhost:3001/",
    });
    expect(config.apiBaseUrl).toBe("http://localhost:3001");
  });

  it("parses the public Admin API URL", () => {
    const config = parsePublicAdminConfig({
      NEXT_PUBLIC_ADMIN_API_BASE_URL: "http://localhost:3001/",
    });
    expect(config.apiBaseUrl).toBe("http://localhost:3001");
  });
});

describe("loadApiConfig", () => {
  it("loads validated API config from an env record", () => {
    const config = loadApiConfig({
      ...validSharedEnv,
      API_HOST: "127.0.0.1",
      API_PORT: "3001",
      WEB_ORIGIN: "http://localhost:3000",
    });

    expect(config.port).toBe(3001);
    expect(config.adminOrigin).toBe("http://localhost:3002");
    expect(config.adminRequireTotp).toBe(true);
    expect(config.adminRequirePasskey).toBe(false);
    expect(config.adminReportingTimezone).toBe("Europe/Moscow");
    expect(config.adminStepUpSeconds).toBe(900);
    expect(config.databaseUrl).toContain("postgresql://");
    expect(config.betterAuthUrl).toBe("http://localhost:3001");
    expect(config.billingTopupRatioBps).toBe("3500");
    expect(config.aiTextEnabled).toBe(true);
    expect(config.aiTextProvider).toBe("mock");
    expect(config.proxyapiBaseUrl).toBe("https://api.proxyapi.ru/v1");
    expect(config.proxyapiApiKey).toBeUndefined();
    expect(config.authOtpDigits).toBe(6);
    expect(config.authOtpExpiresSeconds).toBe(300);
    expect(config.authOtpMaxAttempts).toBe(3);
    expect(config.authOtpResendCooldownSeconds).toBe(60);
    expect(config.authDefaultLocale).toBe("ru");
    expect(config.emailProvider).toBe("memory");
    expect(config.smsProvider).toBe("memory");
    expect(config.notifySmsPerPhonePerHour).toBe(4);
    expect(config.authSignupIpLimitPerMinute).toBe(20);
  });

  it("treats an empty ProxyAPI key as unset", () => {
    const config = loadApiConfig({
      ...validSharedEnv,
      API_HOST: "127.0.0.1",
      API_PORT: "3001",
      WEB_ORIGIN: "http://localhost:3000",
      PROXYAPI_API_KEY: "   ",
    });
    expect(config.proxyapiApiKey).toBeUndefined();
    expect(config.aiTextProvider).toBe("mock");
  });

  it("rejects a local example secret in production", () => {
    expect(() =>
      loadApiConfig({
        ...validSharedEnv,
        APP_ENV: "production",
        AI_TEXT_ENABLED: "false",
        API_HOST: "127.0.0.1",
        API_PORT: "3001",
        WEB_ORIGIN: "https://app.vimla.example",
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "smtp.example.com",
        SMTP_USER: "vimla",
        SMTP_PASSWORD: "smtp-secret-value",
        EMAIL_FROM: "noreply@vimla.example",
        SMS_PROVIDER: "http",
        SMS_HTTP_URL: "https://sms.example.com/send",
        SMS_HTTP_AUTHORIZATION: "Bearer sms-token",
      }),
    ).toThrow();
  });

  it("requires a ProxyAPI key when AI is enabled in production", () => {
    expect(() =>
      loadApiConfig({
        ...validSharedEnv,
        APP_ENV: "production",
        BETTER_AUTH_SECRET: "production-secret-value-32-chars-min",
        API_HOST: "127.0.0.1",
        API_PORT: "3001",
        WEB_ORIGIN: "https://app.vimla.example",
        AI_TEXT_ENABLED: "true",
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "smtp.example.com",
        SMTP_USER: "vimla",
        SMTP_PASSWORD: "smtp-secret-value",
        EMAIL_FROM: "noreply@vimla.example",
        SMS_PROVIDER: "http",
        SMS_HTTP_URL: "https://sms.example.com/send",
        SMS_HTTP_AUTHORIZATION: "Bearer sms-token",
      }),
    ).toThrow();
  });

  it("rejects memory notification providers in production", () => {
    expect(() =>
      loadApiConfig({
        ...validSharedEnv,
        APP_ENV: "production",
        BETTER_AUTH_SECRET: "production-secret-value-32-chars-min",
        API_HOST: "127.0.0.1",
        API_PORT: "3001",
        WEB_ORIGIN: "https://app.vimla.example",
        AI_TEXT_ENABLED: "false",
        EMAIL_PROVIDER: "memory",
        SMS_PROVIDER: "memory",
      }),
    ).toThrow(/EMAIL_PROVIDER/);
  });

  it("rejects a free-mailbox EMAIL_FROM in production", () => {
    expect(() =>
      loadApiConfig({
        ...validSharedEnv,
        APP_ENV: "production",
        BETTER_AUTH_SECRET: "production-secret-value-32-chars-min",
        API_HOST: "127.0.0.1",
        API_PORT: "3001",
        WEB_ORIGIN: "https://app.vimla.example",
        AI_TEXT_ENABLED: "false",
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "smtp.example.com",
        SMTP_USER: "vimla",
        SMTP_PASSWORD: "smtp-secret-value",
        EMAIL_FROM: "noreply@gmail.com",
        SMS_PROVIDER: "http",
        SMS_HTTP_URL: "https://sms.example.com/send",
        SMS_HTTP_AUTHORIZATION: "Bearer sms-token",
      }),
    ).toThrow(/EMAIL_FROM/);
  });

  it("loads production notification adapters when SMTP and HTTP SMS are configured", () => {
    const config = loadApiConfig({
      ...validSharedEnv,
      APP_ENV: "production",
      BETTER_AUTH_SECRET: "production-secret-value-32-chars-min",
      API_HOST: "127.0.0.1",
      API_PORT: "3001",
      WEB_ORIGIN: "https://app.vimla.example",
      AI_TEXT_ENABLED: "false",
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "vimla",
      SMTP_PASSWORD: "smtp-secret-value",
      EMAIL_FROM: "noreply@vimla.example",
      EMAIL_REPLY_TO: "support@vimla.example",
      SMS_PROVIDER: "http",
      SMS_HTTP_URL: "https://sms.example.com/send",
      SMS_HTTP_AUTHORIZATION: "Bearer sms-token",
      ...productionPaymentEnv,
    });

    expect(config.emailProvider).toBe("smtp");
    expect(config.smsProvider).toBe("http");
    expect(config.emailFrom).toBe("noreply@vimla.example");
    expect(config.smtpPassword).toBe("smtp-secret-value");
    expect(config.paymentProvider).toBe("tbank");
    expect(config.tbankApiBaseUrl).toBe("https://securepay.tinkoff.ru");
    expect(config.tbankNotificationUrl).toBe("https://api.vimla.example/webhooks/tbank/payments");
  });

  it("defaults to the mock payment provider in test", () => {
    const config = loadApiConfig({
      ...validSharedEnv,
      API_HOST: "127.0.0.1",
      API_PORT: "3001",
      WEB_ORIGIN: "http://localhost:3000",
    });
    expect(config.paymentProvider).toBe("mock");
    expect(config.tbankPassword).toBe("local-dev-only-tbank-password");
  });

  it("rejects mock payments and incomplete fiscalization in production", () => {
    expect(() =>
      loadApiConfig({
        ...validSharedEnv,
        APP_ENV: "production",
        BETTER_AUTH_SECRET: "production-secret-value-32-chars-min",
        API_HOST: "127.0.0.1",
        API_PORT: "3001",
        WEB_ORIGIN: "https://app.vimla.example",
        AI_TEXT_ENABLED: "false",
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "smtp.example.com",
        SMTP_USER: "vimla",
        SMTP_PASSWORD: "smtp-secret-value",
        EMAIL_FROM: "noreply@vimla.example",
        SMS_PROVIDER: "http",
        SMS_HTTP_URL: "https://sms.example.com/send",
        SMS_HTTP_AUTHORIZATION: "Bearer sms-token",
        ...productionPaymentEnv,
        PAYMENT_PROVIDER: "mock",
      }),
    ).toThrow(/PAYMENT_PROVIDER/);

    expect(() =>
      loadApiConfig({
        ...validSharedEnv,
        API_HOST: "127.0.0.1",
        API_PORT: "3001",
        WEB_ORIGIN: "http://localhost:3000",
        TBANK_FISCALIZATION_ENABLED: "true",
      }),
    ).toThrow(/TBANK_RECEIPT/);
  });
});

describe("loadWorkerConfig", () => {
  it("loads validated worker config from an env record", () => {
    const config = loadWorkerConfig(validSharedEnv);
    expect(config.redisUrl).toBe("redis://localhost:6379");
  });
});
