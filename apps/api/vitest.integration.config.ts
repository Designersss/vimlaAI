import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: {
      NOTIFY_EMAIL_PER_DEST_PER_HOUR: "1000",
      NOTIFY_EMAIL_PER_IP_PER_HOUR: "1000",
      NOTIFY_EMAIL_GLOBAL_PER_MINUTE: "1000",
    },
  },
});
