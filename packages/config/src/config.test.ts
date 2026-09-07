import { describe, expect, it } from "vitest";
import { parsePublicWebConfig } from "./public.js";
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

describe("parsePublicWebConfig", () => {
  it("parses and normalizes the API base URL", () => {
    const config = parsePublicWebConfig({
      NEXT_PUBLIC_API_BASE_URL: "http://localhost:3001/",
    });
    expect(config.apiBaseUrl).toBe("http://localhost:3001");
  });

  it("rejects a missing public API URL", () => {
    expect(() => parsePublicWebConfig({})).toThrow();
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
    expect(config.databaseUrl).toContain("postgresql://");
    expect(config.betterAuthUrl).toBe("http://localhost:3001");
    expect(config.billingTopupRatioBps).toBe("3500");
    expect(config.aiTextEnabled).toBe(true);
    expect(config.aiTextProvider).toBe("mock");
    expect(config.proxyapiBaseUrl).toBe("https://api.proxyapi.ru/v1");
    expect(config.proxyapiApiKey).toBeUndefined();
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
        WEB_ORIGIN: "http://localhost:3000",
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
        WEB_ORIGIN: "http://localhost:3000",
        AI_TEXT_ENABLED: "true",
      }),
    ).toThrow();
  });
});

describe("loadWorkerConfig", () => {
  it("loads validated worker config from an env record", () => {
    const config = loadWorkerConfig(validSharedEnv);
    expect(config.redisUrl).toBe("redis://localhost:6379");
  });
});
