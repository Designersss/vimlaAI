import { describe, expect, it } from "vitest";
import { maskPhoneNumber, normalizeE164 } from "./phone.js";

describe("normalizeE164", () => {
  it("accepts canonical E.164 and Russian local forms", () => {
    expect(normalizeE164("+79991234567")).toBe("+79991234567");
    expect(normalizeE164("8 (999) 123-45-67")).toBe("+79991234567");
    expect(normalizeE164("79991234567")).toBe("+79991234567");
  });

  it("rejects malformed numbers", () => {
    expect(normalizeE164("123")).toBeNull();
    expect(normalizeE164("+0123")).toBeNull();
    expect(normalizeE164("not-a-phone")).toBeNull();
  });
});

describe("maskPhoneNumber", () => {
  it("hides the middle digits", () => {
    expect(maskPhoneNumber("+79991234567")).toBe("+79***67");
  });
});
