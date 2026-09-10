import { describe, expect, it } from "vitest";
import {
  containsForbiddenAuthFields,
  toAuthenticatedUser,
} from "./user.js";

describe("toAuthenticatedUser", () => {
  it("maps a session user without password or session token fields", () => {
    const user = toAuthenticatedUser({
      id: "user_1",
      email: "ada@example.com",
      name: "Ada",
      image: undefined,
      emailVerified: true,
    });

    expect(user).toEqual({
      id: "user_1",
      email: "ada@example.com",
      name: "Ada",
      image: null,
      emailVerified: true,
    });
    expect(containsForbiddenAuthFields(user)).toBe(false);
  });

  it("treats missing verification flags as unverified", () => {
    const user = toAuthenticatedUser({
      id: "user_1",
      email: "ada@example.com",
      name: "Ada",
    });
    expect(user.emailVerified).toBe(false);
  });
});
