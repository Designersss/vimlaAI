import { describe, expect, it } from "vitest";
import { navigationTargetSchema } from "./navigation.js";

describe("navigationTargetSchema", () => {
  it("accepts strict semantic section and entity targets", () => {
    expect(
      navigationTargetSchema.parse({ version: 1, kind: "TODAY" }),
    ).toEqual({ version: 1, kind: "TODAY" });

    const id = "11111111-1111-4111-8111-111111111111";
    expect(
      navigationTargetSchema.parse({ version: 1, kind: "NOTE", id }),
    ).toEqual({ version: 1, kind: "NOTE", id });
  });

  it("rejects unknown kinds, invalid ids, versions and URL-like authority fields", () => {
    expect(() =>
      navigationTargetSchema.parse({ version: 1, kind: "EXTERNAL", url: "https://example.com" }),
    ).toThrow();
    expect(() =>
      navigationTargetSchema.parse({ version: 1, kind: "TASK", id: "not-a-uuid" }),
    ).toThrow();
    expect(() =>
      navigationTargetSchema.parse({ version: 2, kind: "TODAY" }),
    ).toThrow();
    expect(() =>
      navigationTargetSchema.parse({ version: 1, kind: "TODAY", hrefPath: "/work" }),
    ).toThrow();
  });
});
