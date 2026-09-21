import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { config as loadDotenv } from "dotenv";

const webRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(webRoot, "../..");
const apiRoot = resolve(repoRoot, "apps/api");
const workerRoot = resolve(repoRoot, "apps/worker");

loadDotenv({ path: resolve(repoRoot, ".env"), override: false });

const webOrigin = "http://localhost:3100";
const apiBase = "http://localhost:3101";
process.env.WEB_ORIGIN = webOrigin;
process.env.BETTER_AUTH_URL = apiBase;
process.env.NEXT_PUBLIC_API_BASE_URL = apiBase;
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgresql://vimla:vimla@localhost:5432/vimla_test";

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
  API_PORT: "3101",
  WEB_ORIGIN: webOrigin,
  DATABASE_URL: testDatabaseUrl,
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  BETTER_AUTH_URL: apiBase,
  BETTER_AUTH_SECRET:
    process.env.BETTER_AUTH_SECRET ?? "local-dev-only-change-me-use-32-chars-min",
  NEXT_PUBLIC_API_BASE_URL: apiBase,
  AI_TEXT_ENABLED: "true",
  AI_TEXT_PROVIDER: "mock",
  OPERATOR_ENABLED: "true",
  NEXT_PUBLIC_VIMLA_OPERATOR: "true",
  DIRECT_CHATS_ENABLED: "true",
  NEXT_PUBLIC_VIMLA_DIRECT_CHATS: "true",
  PROJECTS_ENABLED: "true",
  NEXT_PUBLIC_VIMLA_PROJECTS: "true",
  NEXT_PUBLIC_VIMLA_ORCHESTRATION_UI: "true",
  EMAIL_PROVIDER: "memory",
  AUTH_OTP_RESEND_COOLDOWN_SECONDS: "2",
  AI_TEXT_RATE_LIMIT_PER_MINUTE: "3",
  AI_TEXT_IP_RATE_LIMIT_PER_MINUTE: "20",
  NOTIFY_EMAIL_PER_IP_PER_HOUR: "1000",
  NOTIFY_EMAIL_GLOBAL_PER_MINUTE: "1000",
  REMINDER_RECONCILE_INTERVAL_SECONDS: "15",
  REMINDER_RECONCILE_BATCH: "500",
  REMINDER_MAX_LATENESS_MINUTES: "1440",
  WORKER_HEALTH_PORT: "3102",
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
    baseURL: webOrigin,
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
      command: "pnpm exec tsx src/main.ts",
      cwd: workerRoot,
      url: "http://127.0.0.1:3102/health",
      reuseExistingServer: false,
      timeout: 180_000,
      env: e2eEnv,
    },
    {
      command: "pnpm exec next dev --port 3100",
      cwd: webRoot,
      url: webOrigin,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        ...e2eEnv,
        NEXT_DIST_DIR: ".next-e2e",
      },
    },
  ],
});
