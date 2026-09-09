import { describe, expect, it } from "vitest";

import { completedAtForStatus } from "./task-service.js";

describe("task completedAt invariant", () => {
  it("sets completedAt only for DONE", () => {
    const now = new Date("2026-09-09T12:00:00.000Z");
    expect(completedAtForStatus("DONE", now)?.toISOString()).toBe(now.toISOString());
    expect(completedAtForStatus("TODO", now)).toBeNull();
    expect(completedAtForStatus("IN_PROGRESS", now)).toBeNull();
    expect(completedAtForStatus("CANCELED", now)).toBeNull();
  });
});
