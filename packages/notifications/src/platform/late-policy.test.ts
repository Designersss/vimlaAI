import { describe, expect, it } from "vitest";
import { isPastMaxLateness } from "./late-policy.js";

describe("reminder late policy", () => {
  it("delivers ordinary lateness and expires beyond the window", () => {
    const scheduledFor = new Date("2026-09-10T12:00:00.000Z");
    expect(
      isPastMaxLateness({
        scheduledFor,
        now: new Date("2026-09-10T12:30:00.000Z"),
        maxLatenessMinutes: 1440,
      }),
    ).toBe(false);
    expect(
      isPastMaxLateness({
        scheduledFor,
        now: new Date("2026-09-12T12:01:00.000Z"),
        maxLatenessMinutes: 1440,
      }),
    ).toBe(true);
  });
});
