import { describe, expect, it } from "vitest";
import { maskEmail } from "./email.js";

describe("maskEmail", () => {
  it("masks the local part", () => {
    expect(maskEmail("ada@example.com")).toBe("a***@example.com");
  });
});
