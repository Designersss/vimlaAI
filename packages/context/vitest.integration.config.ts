import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Integration suites share PostgreSQL coordination tables such as
    // semantic_admission. Running files in parallel can delete/reset those
    // rows while another suite is testing cross-replica admission.
    fileParallelism: false,
  },
});
