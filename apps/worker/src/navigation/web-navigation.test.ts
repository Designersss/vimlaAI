import { describe, expect, it } from "vitest";
import { navigationTargetToWebUrl } from "./web-navigation.js";

describe("navigationTargetToWebUrl", () => {
  it("maps supported notification targets to absolute Web URLs", () => {
    expect(
      navigationTargetToWebUrl("https://vimla.example", {
        version: 1,
        kind: "REMINDER",
        id: "11111111-1111-4111-8111-111111111111",
      }),
    ).toBe("https://vimla.example/work/reminders");
  });

  it("fails closed for unsupported targets or invalid origins", () => {
    expect(
      navigationTargetToWebUrl("javascript:alert(1)", { version: 1, kind: "REMINDERS" }),
    ).toBeUndefined();
    expect(
      navigationTargetToWebUrl("https://vimla.example", { version: 1, kind: "TODAY" }),
    ).toBeUndefined();
  });
});
