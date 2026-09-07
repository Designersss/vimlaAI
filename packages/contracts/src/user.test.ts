import { describe, expect, it } from "vitest";
import { currentUserSchema } from "./user.js";

describe("currentUserSchema", () => {
  it("accepts a public current-user payload", () => {
    const parsed = currentUserSchema.parse({
      id: "user_1",
      email: "ada@example.com",
      name: "Ada",
      image: null,
    });
    expect(parsed.email).toBe("ada@example.com");
  });

  it("does not require password or session token fields", () => {
    const parsed = currentUserSchema.parse({
      id: "user_1",
      email: "ada@example.com",
      name: "Ada",
      image: null,
      password: "should-be-stripped-by-strictness-or-ignored",
    });
    expect("password" in parsed).toBe(false);
  });
});
