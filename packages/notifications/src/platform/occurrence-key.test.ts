import { describe, expect, it } from "vitest";
import { reminderOccurrenceKey, scheduledInstantFromOccurrenceKey } from "./occurrence-key.js";

describe("reminder occurrence key", () => {
  it("uses a canonical UTC ISO instant", () => {
    const scheduledAt = new Date("2026-03-29T10:00:00.000Z");
    const key = reminderOccurrenceKey("rem-1", scheduledAt);
    expect(key).toBe("reminder:rem-1:2026-03-29T10:00:00.000Z");
    expect(scheduledInstantFromOccurrenceKey(key)?.toISOString()).toBe(scheduledAt.toISOString());
  });

  it("rejects malformed keys", () => {
    expect(scheduledInstantFromOccurrenceKey("reminder:rem-1:not-a-date")).toBeNull();
    expect(scheduledInstantFromOccurrenceKey("other:rem-1:2026-03-29T10:00:00.000Z")).toBeNull();
  });
});
