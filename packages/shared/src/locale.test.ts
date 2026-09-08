import { describe, expect, it } from "vitest";
import { localeFromAcceptLanguage, parseVimlaLocale } from "./locale.js";

describe("parseVimlaLocale", () => {
  it("accepts ru and en and defaults to ru", () => {
    expect(parseVimlaLocale("en")).toBe("en");
    expect(parseVimlaLocale("ru")).toBe("ru");
    expect(parseVimlaLocale("de")).toBe("ru");
  });
});

describe("localeFromAcceptLanguage", () => {
  it("prefers the highest-quality supported locale", () => {
    expect(localeFromAcceptLanguage("en-US,en;q=0.9,ru;q=0.8")).toBe("en");
    expect(localeFromAcceptLanguage("ru-RU,ru;q=0.9")).toBe("ru");
    expect(localeFromAcceptLanguage("de-DE,de;q=0.9")).toBe("ru");
  });
});
