import { afterEach, describe, expect, it } from "vitest";
import { isUiCatalogEnabled } from "./ui-catalog";

describe("UI catalog gate", () => {
  const previous = process.env.APP_ENV;

  afterEach(() => {
    process.env.APP_ENV = previous;
  });

  it("is enabled only for local and test APP_ENV", () => {
    process.env.APP_ENV = "local";
    expect(isUiCatalogEnabled()).toBe(true);
    process.env.APP_ENV = "test";
    expect(isUiCatalogEnabled()).toBe(true);
    process.env.APP_ENV = "staging";
    expect(isUiCatalogEnabled()).toBe(false);
    process.env.APP_ENV = "production";
    expect(isUiCatalogEnabled()).toBe(false);
  });
});
