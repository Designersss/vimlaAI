import { describe, expect, it } from "vitest";
import {
  PUBLIC_PROFILE_LIMITS,
  peopleSearchQuerySchema,
  publicProfileSchema,
  updatePublicProfileSchema,
} from "./public-profiles.js";

describe("public profile contracts", () => {
  it("accepts Unicode display names but bounds public fields", () => {
    const parsed = publicProfileSchema.parse({
      userId: "user-1",
      handle: "nikita.user",
      displayName: "Никита 🚀",
      avatarUrl: null,
      bio: "Привет",
      status: "В сети",
    });
    expect(parsed.displayName).toBe("Никита 🚀");

    expect(
      publicProfileSchema.safeParse({
        ...parsed,
        displayName: "я".repeat(81),
      }).success,
    ).toBe(false);
    expect(
      publicProfileSchema.safeParse({
        ...parsed,
        handle: "никита",
      }).success,
    ).toBe(false);
  });

  it("keeps avatar mutation behind the reviewed media boundary", () => {
    expect(
      updatePublicProfileSchema.parse({
        displayName: "  Nikita  ",
        bio: "  ",
        status: " online ",
      }),
    ).toEqual({
      displayName: "Nikita",
      bio: null,
      status: "online",
    });
    expect(
      updatePublicProfileSchema.safeParse({
        avatarUrl: "https://attacker.example/avatar.png",
      }).success,
    ).toBe(false);
  });

  it("rejects PostgreSQL-incompatible NUL in every mutable public text field", () => {
    for (const payload of [
      { displayName: "Nik\0ita" },
      { bio: "bio\0text" },
      { status: "on\0line" },
    ]) {
      expect(updatePublicProfileSchema.safeParse(payload).success).toBe(false);
    }

    expect(
      publicProfileSchema.safeParse({
        userId: "user-1",
        handle: "nikita.user",
        displayName: "Nikita",
        avatarUrl: null,
        bio: "bio\0text",
        status: null,
      }).success,
    ).toBe(false);
  });

  it("bounds discovery and rejects empty @ enumeration", () => {
    expect(PUBLIC_PROFILE_LIMITS.searchPrefixMatchMin).toBe(2);
    expect(PUBLIC_PROFILE_LIMITS.searchContainsMatchMin).toBe(3);
    expect(
      peopleSearchQuerySchema.parse({
        q: "  @Nikita  ",
        limit: "10",
      }),
    ).toEqual({ q: "@Nikita", limit: 10 });
    expect(
      peopleSearchQuerySchema.parse({ q: "李" }),
    ).toEqual({ q: "李", limit: 20 });
    expect(
      peopleSearchQuerySchema.safeParse({ q: "@" }).success,
    ).toBe(false);
    expect(
      peopleSearchQuerySchema.safeParse({ q: "x", limit: 31 }).success,
    ).toBe(false);
  });
});
