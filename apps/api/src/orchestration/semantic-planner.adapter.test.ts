import { describe, expect, it } from "vitest";
import { loadApiConfig } from "@vimla/config/server";
import { createSemanticPlannerModel } from "./semantic-planner.adapter.js";

function testConfig() {
  return loadApiConfig({
    NODE_ENV: "test",
    APP_ENV: "test",
    LOG_LEVEL: "error",
    API_HOST: "127.0.0.1",
    API_PORT: "3001",
    WEB_ORIGIN: "http://localhost:3000",
    DATABASE_URL:
      "postgresql://vimla:vimla@localhost:5432/vimla",
    REDIS_URL: "redis://localhost:6379",
    BETTER_AUTH_SECRET:
      "local-dev-only-change-me-use-32-chars-min",
    BETTER_AUTH_URL: "http://localhost:3001",
  });
}

describe("local semantic planner adapter", () => {
  it("returns valid Memory extraction JSON instead of workflow-only mock errors", async () => {
    const model = createSemanticPlannerModel(testConfig());
    await expect(
      model.complete({
        prompt:
          "You extract durable personal memory from one user-authored message.\nUSER_MESSAGE:\n\"hello\"",
        correlationId: "memory-local-test",
      }),
    ).resolves.toBe(JSON.stringify({ candidates: [] }));
  });

  it("returns valid compacted-state JSON for local/test maintenance", async () => {
    const model = createSemanticPlannerModel(testConfig());
    const raw = await model.complete({
      prompt:
        "Create the next loss-minimizing compacted conversation state.\nNEW_OLDER_RAW_SEGMENT:\n[]",
      correlationId: "compaction-local-test",
    });
    expect(JSON.parse(raw)).toMatchObject({
      summary: "Local/test compacted conversation state",
    });
  });
});
