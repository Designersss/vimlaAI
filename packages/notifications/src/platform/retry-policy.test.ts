import { describe, expect, it } from "vitest";
import { NotificationDeliveryError } from "../errors.js";
import { classifyDeliveryError, nextAttemptAt, shouldRetry } from "./retry-policy.js";

describe("email retry classification", () => {
  it("retries network/timeout/abuse and stops on rejected or ambiguous outcomes", () => {
    expect(classifyDeliveryError(new NotificationDeliveryError("network", "down")).errorClass).toBe("retryable");
    expect(classifyDeliveryError(new NotificationDeliveryError("timeout", "timeout")).errorClass).toBe("retryable");
    expect(classifyDeliveryError(new NotificationDeliveryError("rejected", "bad")).errorClass).toBe("final");
    expect(classifyDeliveryError(new NotificationDeliveryError("ambiguous", "maybe")).errorClass).toBe("ambiguous");
    expect(classifyDeliveryError(new Error("unknown")).errorClass).toBe("ambiguous");
    expect(shouldRetry({ errorClass: "retryable", attemptCount: 2, maxAttempts: 6 })).toBe(true);
    expect(shouldRetry({ errorClass: "retryable", attemptCount: 6, maxAttempts: 6 })).toBe(false);
    expect(shouldRetry({ errorClass: "ambiguous", attemptCount: 1, maxAttempts: 6 })).toBe(false);
    expect(shouldRetry({ errorClass: "final", attemptCount: 1, maxAttempts: 6 })).toBe(false);
  });

  it("caps exponential backoff", () => {
    const now = new Date("2026-09-10T00:00:00.000Z");
    const first = nextAttemptAt({
      attemptCount: 1,
      now,
      backoffBaseMs: 5_000,
      backoffCapMs: 10_000,
    });
    const capped = nextAttemptAt({
      attemptCount: 8,
      now,
      backoffBaseMs: 5_000,
      backoffCapMs: 10_000,
    });
    expect(first.getTime()).toBeGreaterThanOrEqual(now.getTime() + 5_000);
    expect(capped.getTime()).toBeLessThanOrEqual(now.getTime() + 11_000);
  });
});
