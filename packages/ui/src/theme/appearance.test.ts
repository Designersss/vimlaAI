import { describe, expect, it } from "vitest";
import { parseAppearance, resolveTheme } from "./appearance";

describe("appearance", () => {
  it("defaults unknown values to system", () => {
    expect(parseAppearance(undefined)).toBe("system");
    expect(parseAppearance("neon")).toBe("system");
    expect(parseAppearance("dark")).toBe("dark");
  });

  it("resolves system from the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });
});
