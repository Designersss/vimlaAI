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
    expect(config.operatorEnabled).toBe(false);
    expect(config.operatorMaxToolsPerRun).toBe(8);
    expect(config.projectsEnabled).toBe(false);
    expect(config.projectsMutationLimitPerMinute).toBe(60);
    expect(config.projectsInviteTtlDays).toBe(7);
    expect(config.memoryEnabled).toBe(false);
    expect(config.memoryMutationLimitPerMinute).toBe(30);
    expect(config.memoryMaxActivePersonalItems).toBe(1_000);
    expect(config.memoryMaxActiveProjectItems).toBe(2_000);
    expect(config.memoryDerivedAuditRetentionDays).toBe(180);
    expect(config.directChatsEnabled).toBe(false);
    expect(config.directChatsMutationLimitPerMinute).toBe(60);
    expect(config.aiTextProvider).toBe("mock");
    expect(config.semanticPlannerProvider).toBe("mock");
    expect(config.semanticPlannerBaseUrl).toBeUndefined();
    expect(config.semanticPlannerModel).toBeUndefined();
    expect(config.semanticPlannerApiKey).toBeUndefined();
    expect(config.semanticPlannerTimeoutMs).toBe(120_000);
    expect(config.orchestrationEnabled).toBe(true);
    expect(config.semanticPlannerEnabled).toBe(true);
    expect(config.contextRetrievalEnabled).toBe(true);
    expect(config.semanticRetrievalEnabled).toBe(true);
    expect(config.proxyapiBaseUrl).toBe("https://api.proxyapi.ru/v1");
    expect(config.proxyapiApiKey).toBeUndefined();
    expect(config.authOtpDigits).toBe(6);
    expect(config.authOtpExpiresSeconds).toBe(300);
    expect(config.authOtpMaxAttempts).toBe(3);
    expect(config.authOtpResendCooldownSeconds).toBe(60);
    expect(config.authDefaultLocale).toBe("ru");
    expect(config.emailProvider).toBe("memory");
    expect(config.authSignupIpLimitPerMinute).toBe(20);
    expect(config.reminderReconcileIntervalSeconds).toBe(60);
    expect(config.reminderMaxLatenessMinutes).toBe(1_440);
    expect(config.notifyDeliveryMaxAttempts).toBe(6);
  });

  it("keeps PR-20 auto rollout gates off in production", () => {
    const config = loadApiConfig({
      ...validSharedEnv,
      APP_ENV: "production",
      API_HOST: "127.0.0.1",
      API_PORT: "3001",
      BETTER_AUTH_SECRET: "production-api-secret-value-32-chars-min",
      BETTER_AUTH_URL: "https://api.vimla.example",
      AI_TEXT_ENABLED: "false",
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "vimla",
      SMTP_PASSWORD: "smtp-secret-value",
      EMAIL_FROM: "noreply@vimla.example",
      ...productionPaymentEnv,
    });

    expect(config.orchestrationEnabled).toBe(false);
    expect(config.semanticPlannerEnabled).toBe(false);
    expect(config.contextRetrievalEnabled).toBe(false);
    expect(config.semanticRetrievalEnabled).toBe(false);
  });

  it("requires production dependencies before semantic rollout gates can be enabled", () => {
    const base = {
      ...validSharedEnv,
      APP_ENV: "production",
      API_HOST: "127.0.0.1",
      API_PORT: "3001",
      BETTER_AUTH_SECRET: "production-api-secret-value-32-chars-min",
      BETTER_AUTH_URL: "https://api.vimla.example",
      AI_TEXT_ENABLED: "false",
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "vimla",
      SMTP_PASSWORD: "smtp-secret-value",
      EMAIL_FROM: "noreply@vimla.example",
      ...productionPaymentEnv,
    } as const;

    expect(() =>
      loadApiConfig({
        ...base,
        SEMANTIC_PLANNER_ENABLED: "true",
      }),
    ).toThrow(/SEMANTIC_PLANNER_ENABLED/);

    expect(() =>
      loadApiConfig({
        ...base,
        SEMANTIC_RETRIEVAL_ENABLED: "true",
      }),
    ).toThrow(/SEMANTIC_RETRIEVAL_ENABLED/);
  });

  it("enables durable Memory only through its explicit fail-closed flag", () => {
    const config = loadApiConfig({
      ...validSharedEnv,
      API_HOST: "127.0.0.1",
      API_PORT: "3001",
      WEB_ORIGIN: "http://localhost:3000",
      MEMORY_ENABLED: "true",
    });
    expect(config.memoryEnabled).toBe(true);
  });

  it("selects a dedicated internal semantic planner without changing paid AI routing", () => {
    const config = loadApiConfig({
      ...validSharedEnv,
      API_HOST: "127.0.0.1",
      API_PORT: "3001",
      WEB_ORIGIN: "http://localhost:3000",
      SEMANTIC_PLANNER_PROVIDER: "internal-http",
      SEMANTIC_PLANNER_BASE_URL: "http://127.0.0.1:11434/v1/",
      SEMANTIC_PLANNER_MODEL: "qwen-planner",
      SEMANTIC_PLANNER_API_KEY: "internal-secret",
      SEMANTIC_PLANNER_TIMEOUT_MS: "45000",
    });

    expect(config.semanticPlannerProvider).toBe("internal-http");
    expect(config.semanticPlannerBaseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(config.semanticPlannerModel).toBe("qwen-planner");
    expect(config.semanticPlannerApiKey).toBe("internal-secret");
    expect(config.semanticPlannerTimeoutMs).toBe(45_000);
    expect(config.aiTextProvider).toBe("mock");
  });

  it("requires endpoint and model for an explicit internal semantic planner", () => {
    expect(() =>
      loadApiConfig({
        ...validSharedEnv,
        API_HOST: "127.0.0.1",
        API_PORT: "3001",
        WEB_ORIGIN: "http://localhost:3000",
        SEMANTIC_PLANNER_PROVIDER: "internal-http",
      }),
    ).toThrow(/SEMANTIC_PLANNER/);
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
      }),
    ).toThrow();
  });

  it("disables an unconfigured semantic planner outside local/test and rejects explicit mocks", () => {
    const productionBase = {
      ...validSharedEnv,
      ...productionPaymentEnv,
      APP_ENV: "production",
      BETTER_AUTH_SECRET: "production-secret-value-32-chars-min",
      API_HOST: "127.0.0.1",
      API_PORT: "3001",
      AI_TEXT_ENABLED: "false",
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "vimla",
      SMTP_PASSWORD: "smtp-secret-value",
      EMAIL_FROM: "noreply@vimla.example",
    };

    expect(loadApiConfig(productionBase).semanticPlannerProvider).toBe("disabled");
    expect(() =>
      loadApiConfig({
        ...productionBase,
        SEMANTIC_PLANNER_PROVIDER: "mock",
      }),
    ).toThrow(/SEMANTIC_PLANNER_PROVIDER/);

    expect(() =>
      loadApiConfig({
        ...productionBase,
        MEMORY_ENABLED: "true",
      }),
    ).toThrow(/MEMORY_ENABLED/);

    const memoryReady = loadApiConfig({
      ...productionBase,
      MEMORY_ENABLED: "true",
      SEMANTIC_PLANNER_BASE_URL:
        "http://127.0.0.1:11434/v1",
      SEMANTIC_PLANNER_MODEL: "qwen-memory",
      MEMORY_DERIVED_AUDIT_RETENTION_DAYS: "365",
    });
    expect(memoryReady.memoryEnabled).toBe(true);
    expect(memoryReady.semanticPlannerProvider).toBe(
      "internal-http",
    );
    expect(
      memoryReady.memoryDerivedAuditRetentionDays,
    ).toBe(365);
  });

  it("requires an explicit Memory derived-audit retention period in staging/production", () => {
    const productionBase = {
      ...validSharedEnv,
      ...productionPaymentEnv,
      APP_ENV: "production",
      BETTER_AUTH_SECRET: "production-secret-value-32-chars-min",
      API_HOST: "127.0.0.1",
      API_PORT: "3001",
      AI_TEXT_ENABLED: "false",
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "vimla",
      SMTP_PASSWORD: "smtp-secret-value",
      EMAIL_FROM: "noreply@vimla.example",
      MEMORY_ENABLED: "true",
      SEMANTIC_PLANNER_BASE_URL:
        "http://127.0.0.1:11434/v1",
      SEMANTIC_PLANNER_MODEL: "qwen-memory",
    } as const;

    expect(() =>
      loadApiConfig(productionBase),
    ).toThrow(/MEMORY_DERIVED_AUDIT_RETENTION_DAYS/);
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
      }),
    ).toThrow(/EMAIL_FROM/);
  });

  it("loads production notification adapters when SMTP is configured without SMS variables", () => {
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
      ...productionPaymentEnv,
    });

    expect(config.emailProvider).toBe("smtp");
    expect(config.operatorEnabled).toBe(false);
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
    expect(config.emailProvider).toBe("memory");
    expect(config.reminderReconcileIntervalSeconds).toBe(60);
    expect(config.webOrigin).toBe("http://localhost:3000");
    expect(config.workerHealthPort).toBeUndefined();
    expect(config.vimlaCoreProvider).toBe("deterministic");
    expect(config.vimlaCoreBaseUrl).toBeUndefined();
    expect(config.vimlaCoreModel).toBeUndefined();
    expect(config.vimlaCoreToolUseEnabled).toBe(true);
    expect(config.vimlaCoreFairUseRequestsPerMinute).toBe(20);
    expect(config.vimlaCoreFairUseMaxConcurrentPerUser).toBe(2);
    expect(config.orchestrationEnabled).toBe(true);
    expect(config.contextRetrievalEnabled).toBe(true);
    expect(config.semanticRetrievalEnabled).toBe(true);
    expect(config.localAiEnabled).toBe(true);
  });

  it("keeps worker auto rollout gates off in production", () => {
    const config = loadWorkerConfig({
      ...validSharedEnv,
      APP_ENV: "production",
      BETTER_AUTH_SECRET: "production-worker-secret-value-32-chars-min",
      WEB_ORIGIN: "https://app.vimla.example",
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "vimla",
      SMTP_PASSWORD: "smtp-secret-value",
      EMAIL_FROM: "noreply@vimla.example",
      PAYMENT_PROVIDER: "tbank",
      TBANK_ENV: "production",
      TBANK_TERMINAL_KEY: "production-terminal-key",
      TBANK_PASSWORD: "production-tbank-password-value",
    });

    expect(config.orchestrationEnabled).toBe(false);
    expect(config.contextRetrievalEnabled).toBe(false);
    expect(config.semanticRetrievalEnabled).toBe(false);
    expect(config.localAiEnabled).toBe(false);
    expect(config.vimlaCoreProvider).toBe("disabled");
  });

  it("rejects production local-AI enablement without the internal provider", () => {
    expect(() =>
      loadWorkerConfig({
        ...validSharedEnv,
        APP_ENV: "production",
        BETTER_AUTH_SECRET: "production-worker-secret-value-32-chars-min",
        WEB_ORIGIN: "https://app.vimla.example",
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "smtp.example.com",
        SMTP_USER: "vimla",
        SMTP_PASSWORD: "smtp-secret-value",
        EMAIL_FROM: "noreply@vimla.example",
        PAYMENT_PROVIDER: "tbank",
        TBANK_ENV: "production",
        TBANK_TERMINAL_KEY: "production-terminal-key",
        TBANK_PASSWORD: "production-tbank-password-value",
        LOCAL_AI_ENABLED: "true",
      }),
    ).toThrow(/LOCAL_AI_ENABLED/);
  });

  it("resolves a dedicated internal Vimla Core provider without paid-AI fallback settings", () => {
    const configured = loadWorkerConfig({
      ...validSharedEnv,
      VIMLA_CORE_PROVIDER: "internal-http",
      VIMLA_CORE_INTERNAL_CONFIRMED: "true",
      VIMLA_CORE_BASE_URL: "http://127.0.0.1:18080/v1/",
      VIMLA_CORE_MODEL: "qwen-vimla-core",
      VIMLA_CORE_API_KEY: "internal-only-secret",
      VIMLA_CORE_TIMEOUT_MS: "45000",
      VIMLA_CORE_MAX_OUTPUT_TOKENS: "1024",
      VIMLA_CORE_MAX_REQUEST_BYTES: "131072",
      VIMLA_CORE_MAX_CONCURRENT_REQUESTS: "3",
      VIMLA_CORE_MAX_QUEUE_DEPTH: "12",
      VIMLA_CORE_CIRCUIT_FAILURE_THRESHOLD: "4",
      VIMLA_CORE_CIRCUIT_RESET_MS: "20000",
      VIMLA_CORE_TOOL_USE_ENABLED: "false",
      VIMLA_CORE_FAIR_USE_REQUESTS_PER_MINUTE: "15",
      VIMLA_CORE_FAIR_USE_MAX_CONCURRENT_PER_USER: "1",
    });

    expect(configured.vimlaCoreProvider).toBe("internal-http");
    expect(configured.vimlaCoreBaseUrl).toBe("http://127.0.0.1:18080/v1");
    expect(configured.vimlaCoreModel).toBe("qwen-vimla-core");
    expect(configured.vimlaCoreApiKey).toBe("internal-only-secret");
    expect(configured.vimlaCoreTimeoutMs).toBe(45_000);
    expect(configured.vimlaCoreMaxOutputTokens).toBe(1_024);
    expect(configured.vimlaCoreMaxRequestBytes).toBe(131_072);
    expect(configured.vimlaCoreMaxConcurrentRequests).toBe(3);
    expect(configured.vimlaCoreMaxQueueDepth).toBe(12);
    expect(configured.vimlaCoreCircuitFailureThreshold).toBe(4);
    expect(configured.vimlaCoreCircuitResetMs).toBe(20_000);
    expect(configured.vimlaCoreToolUseEnabled).toBe(false);
    expect(configured.vimlaCoreFairUseRequestsPerMinute).toBe(15);
    expect(configured.vimlaCoreFairUseMaxConcurrentPerUser).toBe(1);
  });

  it("requires explicit self-hosted confirmation, endpoint, and model for Vimla Core", () => {
    expect(() =>
      loadWorkerConfig({
        ...validSharedEnv,
        VIMLA_CORE_PROVIDER: "internal-http",
        VIMLA_CORE_BASE_URL: "http://127.0.0.1:18080/v1",
        VIMLA_CORE_MODEL: "qwen-vimla-core",
      }),
    ).toThrow(/VIMLA_CORE_INTERNAL_CONFIRMED/);

    expect(() =>
      loadWorkerConfig({
        ...validSharedEnv,
        VIMLA_CORE_PROVIDER: "internal-http",
        VIMLA_CORE_INTERNAL_CONFIRMED: "true",
      }),
    ).toThrow(/VIMLA_CORE_BASE_URL|VIMLA_CORE_MODEL/);
  });

  it("rejects Vimla Core endpoints with embedded authority or URL decorations", () => {
    for (const baseUrl of [
      "http://user:pass@127.0.0.1:18080/v1",
      "http://127.0.0.1:18080/v1?token=secret",
      "http://127.0.0.1:18080/v1#fragment",
    ]) {
      expect(() =>
        loadWorkerConfig({
          ...validSharedEnv,
          VIMLA_CORE_PROVIDER: "internal-http",
          VIMLA_CORE_INTERNAL_CONFIRMED: "true",
          VIMLA_CORE_BASE_URL: baseUrl,
          VIMLA_CORE_MODEL: "qwen-vimla-core",
        }),
      ).toThrow(/clean http\(s\) endpoint/);
    }
  });

  it("rejects a partial auto Vimla Core configuration instead of silently falling back", () => {
    expect(() =>
      loadWorkerConfig({
        ...validSharedEnv,
        VIMLA_CORE_PROVIDER: "auto",
        VIMLA_CORE_INTERNAL_CONFIRMED: "true",
        VIMLA_CORE_BASE_URL: "http://127.0.0.1:18080/v1",
      }),
    ).toThrow(/VIMLA_CORE_MODEL/);
  });

  it("rejects deterministic Vimla Core in staging and production", () => {
    expect(() =>
      loadWorkerConfig({
        ...validSharedEnv,
        APP_ENV: "production",
        BETTER_AUTH_SECRET: "production-worker-secret-value-32-chars-min",
        WEB_ORIGIN: "https://app.vimla.example",
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "smtp.example.com",
        SMTP_USER: "vimla",
        SMTP_PASSWORD: "smtp-secret-value",
        EMAIL_FROM: "noreply@vimla.example",
        PAYMENT_PROVIDER: "tbank",
        TBANK_ENV: "production",
        TBANK_TERMINAL_KEY: "production-terminal-key",
        TBANK_PASSWORD: "production-tbank-password-value",
        VIMLA_CORE_PROVIDER: "deterministic",
      }),
    ).toThrow(/VIMLA_CORE_PROVIDER/);
  });

  it("keeps AI evaluator disabled by default and validates internal-http settings", () => {
    expect(loadWorkerConfig(validSharedEnv).evaluatorProvider).toBe("disabled");

    expect(() =>
      loadWorkerConfig({
        ...validSharedEnv,
        EVALUATOR_PROVIDER: "internal-http",
      }),
    ).toThrow(/EVALUATOR_BASE_URL|EVALUATOR_MODEL/);

    const configured = loadWorkerConfig({
      ...validSharedEnv,
      EVALUATOR_PROVIDER: "internal-http",
      EVALUATOR_BASE_URL: "http://127.0.0.1:11434/v1",
      EVALUATOR_MODEL: "internal-evaluator",
      EVALUATOR_TIMEOUT_MS: "45000",
    });
    expect(configured.evaluatorProvider).toBe("internal-http");
    expect(configured.evaluatorBaseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(configured.evaluatorModel).toBe("internal-evaluator");
    expect(configured.evaluatorTimeoutMs).toBe(45_000);
  });

  it("accepts an optional loopback health port", () => {
    const config = loadWorkerConfig({
      ...validSharedEnv,
      WORKER_HEALTH_PORT: "3102",
    });
    expect(config.workerHealthPort).toBe(3102);
  });
});
