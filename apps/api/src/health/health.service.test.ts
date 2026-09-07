import { describe, expect, it } from "vitest";
import { aggregateStatus } from "./health.service.js";

describe("aggregateStatus", () => {
  it("is ok when every check succeeds", () => {
    expect(
      aggregateStatus(
        { status: "ok" },
        { status: "ok" },
        { status: "ok" },
      ),
    ).toBe("ok");
  });

  it("is degraded when a dependency fails", () => {
    expect(
      aggregateStatus(
        { status: "ok" },
        { status: "error", detail: "db down" },
        { status: "ok" },
      ),
    ).toBe("degraded");
  });
});
