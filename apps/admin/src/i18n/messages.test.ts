import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import ru from "../../messages/ru.json";

function collectKeys(value: unknown, prefix = ""): string[] {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
      const next = prefix ? `${prefix}.${key}` : key;
      return collectKeys(nested, next);
    });
  }
  return prefix ? [prefix] : [];
}

describe("admin i18n", () => {
  it("keeps RU and EN keys in sync", () => {
    expect(collectKeys(ru).sort()).toEqual(collectKeys(en).sort());
    expect(collectKeys(ru)).toContain("finance.outstandingTopup");
    expect(collectKeys(ru)).toContain("topup.noExpiry");
  });
});
