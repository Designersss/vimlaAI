import { describe, expect, it } from "vitest";
import { hmacSha256Hex, hmacTimingSafeEqualHex } from "./hmac.js";

describe("hmacSha256Hex", () => {
  it("is deterministic and keyed", () => {
    const first = hmacSha256Hex("secret-a", "otp:123456");
    const second = hmacSha256Hex("secret-a", "otp:123456");
    const otherKey = hmacSha256Hex("secret-b", "otp:123456");
    expect(first).toBe(second);
    expect(first).not.toBe(otherKey);
    expect(first).toHaveLength(64);
  });

  it("compares hashes in constant time", () => {
    const digest = hmacSha256Hex("secret", "value");
    expect(hmacTimingSafeEqualHex(digest, digest)).toBe(true);
    expect(hmacTimingSafeEqualHex(digest, hmacSha256Hex("secret", "other"))).toBe(
      false,
    );
  });
});
