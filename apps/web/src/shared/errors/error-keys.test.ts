import { describe, expect, it } from "vitest";
import {
  authErrorMessageKey,
  authRetryAfterSeconds,
  isAuthRateLimitError,
} from "./error-keys";

describe("auth error mapping", () => {
  it("maps duplicate signup to the generic registration message", () => {
    expect(authErrorMessageKey("REGISTRATION_FAILED")).toBe("auth.errors.registrationFailed");
    expect(authErrorMessageKey("USER_ALREADY_EXISTS")).toBe("auth.errors.registrationFailed");
  });

  it("does not treat registration failure as a rate limit", () => {
    expect(isAuthRateLimitError({ code: "REGISTRATION_FAILED", status: 400 })).toBe(false);
    expect(authRetryAfterSeconds({ code: "REGISTRATION_FAILED" })).toBeNull();
  });

  it("treats HTTP 429 and TOO_MANY_REQUESTS as rate limits and uses retryAfter", () => {
    expect(isAuthRateLimitError({ status: 429 })).toBe(true);
    expect(isAuthRateLimitError({ code: "TOO_MANY_REQUESTS" })).toBe(true);
    expect(authRetryAfterSeconds({ status: 429 }, 12)).toBe(12);
    expect(authRetryAfterSeconds({ code: "TOO_MANY_REQUESTS", retryAfter: "8" })).toBe(8);
  });

  it("does not treat OTP attempt/resend codes as signup rate limits", () => {
    expect(isAuthRateLimitError({ code: "TOO_MANY_ATTEMPTS", status: 429 })).toBe(false);
    expect(isAuthRateLimitError({ code: "OTP_RESEND_TOO_SOON", status: 429 })).toBe(false);
  });
});
