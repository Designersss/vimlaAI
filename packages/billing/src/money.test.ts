import { describe, expect, it } from "vitest";
import {
  MICRORUB_PER_RUB,
  kopecksToMicroRub,
  microRubFromJson,
  microRubToJson,
  microRubToKopecks,
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

  it("converts whole kopecks without floating point", () => {
    expect(microRubToKopecks(rubToMicroRub(3n) + 120_000n)).toBe(312n);
    expect(kopecksToMicroRub(312n)).toBe(3_120_000n);
    expect(() => microRubToKopecks(1n)).toThrow(/kopecks/);
  });
});

describe("top-up provider budget", () => {
  it("uses integer floor division at 35%", () => {
    expect(topupProviderBudgetMicroRub(rubToMicroRub(1000n), 3500n)).toBe(
      rubToMicroRub(350n),
    );
  });
});

describe("conservative fee rounding", () => {
  it("ceils remainder microRUB instead of flooring", async () => {
    const { applyBpsCeil } = await import("./money.js");
    expect(applyBpsCeil(100n, 1n)).toBe(1n);
    expect(applyBpsCeil(10_000n, 2500n)).toBe(2500n);
  });
});

describe("used percent", () => {
  it("floors committed usage including reservations", () => {
    expect(usedPercentFloor(35n, 100n)).toBe(35);
    expect(usedPercentFloor(1n, 3n)).toBe(33);
  });
});
