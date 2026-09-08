import { describe, expect, it } from "vitest";
import { passwordTooShort } from "./validation";

describe("password validation", () => {
  it("rejects passwords shorter than 8 characters", () => {
    expect(passwordTooShort("short")).toBe(true);
    expect(passwordTooShort("12345678")).toBe(false);
  });
});
