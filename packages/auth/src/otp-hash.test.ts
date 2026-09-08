import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { hashOtp } from "./otp-hash.js";

describe("hashOtp", () => {
  it("uses a keyed HMAC instead of unsalted SHA of the digits", () => {
    const otp = "123456";
    const hashed = hashOtp("server-secret", otp, "email");
    const unsalted = createHash("sha256").update(otp).digest("hex");
    expect(hashed).not.toBe(otp);
    expect(hashed).not.toBe(unsalted);
    expect(hashOtp("server-secret", otp, "email")).toBe(hashed);
    expect(hashOtp("other-secret", otp, "email")).not.toBe(hashed);
  });
});
