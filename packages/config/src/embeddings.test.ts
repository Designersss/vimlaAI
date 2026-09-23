import { describe, expect, it } from "vitest";
import { loadApiConfig, loadWorkerConfig } from "./server.js";
const env = {
  APP_ENV: "test",
  DATABASE_URL: "postgresql://local/test",
  REDIS_URL: "redis://localhost:6379",
  BETTER_AUTH_URL: "http://localhost:3001",
  BETTER_AUTH_SECRET: "local-dev-only-change-me-use-32-chars-min",
};
describe("embedding configuration", () => {
  for (const load of [loadApiConfig, loadWorkerConfig]) {
    it("is disabled by default and never selects mocks", () => {
      expect(load(env).embeddings).toBeUndefined();
      expect(() => load({ ...env, EMBEDDING_PROVIDER: "mock" })).toThrow();
    });
    it("requires confirmed included inference and a pinned model identity", () => {
      expect(() =>
        load({ ...env, EMBEDDING_PROVIDER: "internal-http" }),
      ).toThrow(/EMBEDDING_INTERNAL_CONFIRMED/);
      expect(() =>
        load({
          ...env,
          EMBEDDING_PROVIDER: "internal-http",
          EMBEDDING_INTERNAL_CONFIRMED: "true",
        }),
      ).toThrow();
      expect(
        load({
          ...env,
          EMBEDDING_PROVIDER: "internal-http",
          EMBEDDING_INTERNAL_CONFIRMED: "true",
          EMBEDDING_BASE_URL: "http://127.0.0.1:8080/v1",
          EMBEDDING_MODEL: "model",
          EMBEDDING_MODEL_REVISION: "rev",
        }).embeddings?.revision,
      ).toBe("rev");
    });
  }
});
