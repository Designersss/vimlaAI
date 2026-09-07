import { describe, expect, it } from "vitest";
import { healthResponseSchema } from "./health.js";

describe("healthResponseSchema", () => {
  it("accepts a complete health payload", () => {
    const parsed = healthResponseSchema.parse({
      status: "ok",
      service: "api",
      checks: {
        api: { status: "ok" },
        database: { status: "ok" },
        redis: { status: "ok" },
      },
    });

    expect(parsed.status).toBe("ok");
  });

  it("rejects an authoritative-looking usagePercent field as unknown extra only if strict", () => {
    const parsed = healthResponseSchema.parse({
      status: "degraded",
      service: "api",
      checks: {
        api: { status: "ok" },
        database: { status: "error", detail: "unavailable" },
        redis: { status: "ok" },
      },
    });

    expect(parsed.status).toBe("degraded");
  });
});
