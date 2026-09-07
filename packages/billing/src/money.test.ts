import { describe, expect, it } from "vitest";
import {
  MICRORUB_PER_RUB,
  microRubFromJson,
  microRubToJson,
  rubToMicroRub,
  topupProviderBudgetMicroRub,
  usedPercentFloor,
} from "./money.js";

describe("microRUB serialization", () => {
  it("round-trips integer strings without using number", () => {
    const value = rubToMicroRub(150n);
    expect(value).toBe(150n * MICRORUB_PER_RUB);
    expect(microRubFromJson(microRubToJson(value))).toBe(value);
  });

  it("rejects non-integer JSON payloads", () => {
    expect(() => microRubFromJson("12.5")).toThrow();
    expect(() => microRubFromJson("1e6")).toThrow();
  });

  it("preserves fractional-ruble precision in integer microRUB", () => {
    expect(microRubFromJson("3217")).toBe(3217n);
  });
});

describe("top-up provider budget", () => {
  it("uses integer floor division at 35%", () => {
    expect(topupProviderBudgetMicroRub(rubToMicroRub(1000n), 3500n)).toBe(
      rubToMicroRub(350n),
    );
  });
});

describe("used percent", () => {
  it("floors committed usage including reservations", () => {
    expect(usedPercentFloor(35n, 100n)).toBe(35);
    expect(usedPercentFloor(1n, 3n)).toBe(33);
  });
});
