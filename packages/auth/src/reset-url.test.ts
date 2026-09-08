import { describe, expect, it } from "vitest";
import { buildTrustedPasswordResetUrl } from "./reset-url.js";

describe("buildTrustedPasswordResetUrl", () => {
  it("builds a reset URL only on the trusted web origin", () => {
    const url = buildTrustedPasswordResetUrl("http://localhost:3000", "reset-token-value");
    expect(url).toBe("http://localhost:3000/reset-password?token=reset-token-value");
  });

  it("rejects tokens that could be used as a redirect target", () => {
    expect(() =>
      buildTrustedPasswordResetUrl("http://localhost:3000", "https://evil.example/phish"),
    ).toThrow(/Invalid password reset token/);
  });
});
