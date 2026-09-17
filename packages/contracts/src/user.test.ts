import { describe, expect, it } from "vitest";
import { currentUserSchema } from "./user.js";

describe("currentUserSchema", () => {
  it("accepts a public current-user payload", () => {
    const parsed = currentUserSchema.parse({
      id: "user_1",
      email: "ada@example.com",
      name: "Ada",
      image: null,
      emailVerified: true,
      handle: "ada",
      handleStatus: "ACTIVE",
      handleRequired: false,
      locale: "ru",
      timezone: null,
    });
    expect(parsed.email).toBe("ada@example.com");
    expect(parsed.handle).toBe("ada");
    expect(parsed.handleStatus).toBe("ACTIVE");
    expect(parsed.handleRequired).toBe(false);
  });

  it("does not require password or session token fields", () => {
    const parsed = currentUserSchema.parse({
      id: "user_1",
      email: "ada@example.com",
      name: "Ada",
      image: null,
      emailVerified: false,
      handle: null,
      handleStatus: null,
      handleRequired: true,
      locale: "en",
      timezone: null,
      password: "should-be-stripped-by-strictness-or-ignored",
    });
    expect("password" in parsed).toBe(false);
    expect(parsed.handle).toBeNull();
    expect(parsed.handleStatus).toBeNull();
    expect(parsed.handleRequired).toBe(true);
  });
});
