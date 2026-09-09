import { describe, expect, it } from "vitest";
import { isIanaTimeZone, WORKSPACE_LIMITS } from "@vimla/contracts";
import { zonedDayBounds, zonedLocalToUtc } from "./timezone.js";

describe("IANA timezone validation", () => {
  it("accepts IANA names and rejects numeric offsets", () => {
    expect(isIanaTimeZone("Europe/Moscow")).toBe(true);
    expect(isIanaTimeZone("Europe/Amsterdam")).toBe(true);
    expect(isIanaTimeZone("UTC")).toBe(true);
    expect(isIanaTimeZone("+03:00")).toBe(false);
    expect(isIanaTimeZone("GMT+3")).toBe(false);
    expect(isIanaTimeZone("")).toBe(false);
  });
});

describe("DST-aware day bounds", () => {
  it("keeps Amsterdam spring-forward midnight as a real instant", () => {
    const start = zonedLocalToUtc(2026, 3, 29, 0, 0, "Europe/Amsterdam");
    const noonGuess = zonedLocalToUtc(2026, 3, 29, 12, 0, "Europe/Amsterdam");
    const { start: dayStart, end } = zonedDayBounds(noonGuess, "Europe/Amsterdam");
    expect(dayStart.toISOString()).toBe(start.toISOString());
    expect(end.getTime() - dayStart.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it("keeps Amsterdam fall-back day 25 hours long", () => {
    const noon = zonedLocalToUtc(2026, 10, 25, 12, 0, "Europe/Amsterdam");
    const { start, end } = zonedDayBounds(noon, "Europe/Amsterdam");
    expect(end.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000);
  });
});

describe("workspace limits", () => {
  it("centralizes technical content bounds", () => {
    expect(WORKSPACE_LIMITS.titleMax).toBe(200);
    expect(WORKSPACE_LIMITS.noteContentMax).toBe(50_000);
    expect(WORKSPACE_LIMITS.listItemsMax).toBe(200);
    expect(WORKSPACE_LIMITS.pageLimitMax).toBe(50);
  });
});
