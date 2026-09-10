import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { config as loadDotenv } from "dotenv";

const adminRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(adminRoot, "../..");
const apiRoot = resolve(repoRoot, "apps/api");

loadDotenv({ path: resolve(repoRoot, ".env"), override: false });

const adminOrigin = "http://localhost:3202";
const apiBase = "http://localhost:3201";
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgresql://vimla:vimla@localhost:5432/vimla_test";

process.env.ADMIN_ORIGIN = adminOrigin;
process.env.BETTER_AUTH_URL = apiBase;
process.env.DATABASE_URL = testDatabaseUrl;
process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL = apiBase;

function inheritedEnv(): Record<string, string> {
  const copied: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      copied[key] = value;
    }
  }
  return copied;
}

const e2eEnv: Record<string, string> = {
  ...inheritedEnv(),
  NODE_ENV: "test",
  APP_ENV: "test",
  LOG_LEVEL: "error",
  API_HOST: "127.0.0.1",
  API_PORT: "3201",
  WEB_ORIGIN: "http://localhost:3000",
  ADMIN_ORIGIN: adminOrigin,
  DATABASE_URL: testDatabaseUrl,
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  BETTER_AUTH_URL: apiBase,
  BETTER_AUTH_SECRET:
    process.env.BETTER_AUTH_SECRET ?? "local-dev-only-change-me-use-32-chars-min",
  NEXT_PUBLIC_API_BASE_URL: apiBase,
  NEXT_PUBLIC_ADMIN_API_BASE_URL: apiBase,
  ADMIN_REQUIRE_TOTP: "true",
  ADMIN_REQUIRE_PASSKEY: "false",
  ADMIN_WEBAUTHN_RP_ID: "localhost",
  ADMIN_WEBAUTHN_ORIGIN: adminOrigin,
  AI_TEXT_ENABLED: "true",
  AI_TEXT_PROVIDER: "mock",
  EMAIL_PROVIDER: "memory",
  AUTH_OTP_RESEND_COOLDOWN_SECONDS: "2",
  NOTIFY_EMAIL_PER_IP_PER_HOUR: "1000",
  NOTIFY_EMAIL_GLOBAL_PER_MINUTE: "1000",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: adminOrigin,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "webkit-mobile",
      testMatch: /responsive-cross-browser\.spec\.ts/,
      use: { ...devices["iPhone 13"] },
    },
    {
      name: "firefox-shell",
      testMatch: /responsive-cross-browser\.spec\.ts/,
      use: { ...devices["Desktop Firefox"] },
    },
  ],
  webServer: [
    {
      command: "pnpm exec tsx src/main.ts",
      cwd: apiRoot,
      url: `${apiBase}/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: e2eEnv,
    },
    {
      command: "pnpm exec next dev --port 3202",
      cwd: adminRoot,
      url: adminOrigin,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        ...e2eEnv,
        NEXT_DIST_DIR: ".next-e2e",
      },
    },
  ],
});
