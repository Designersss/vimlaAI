import { describe, expect, it } from "vitest";
import {
  communicationSurfaceKindSchema,
  communicationSurfaceRefSchema,
} from "./communication-surfaces.js";

describe("communication surface contracts", () => {
  it("accepts only currently supported versioned surface kinds", () => {
    expect(
      communicationSurfaceKindSchema.safeParse("AI_THREAD").success,
    ).toBe(true);
    expect(
      communicationSurfaceKindSchema.safeParse("DIRECT").success,
    ).toBe(true);
    expect(
      communicationSurfaceKindSchema.safeParse("GROUP").success,
    ).toBe(false);
  });

  it("exposes routing identity without accepting authority fields", () => {
    const parsed = communicationSurfaceRefSchema.safeParse({
      surfaceId: "11111111-1111-4111-8111-111111111111",
      surfaceKind: "DIRECT",
    });
    expect(parsed.success).toBe(true);

    expect(
      communicationSurfaceRefSchema.safeParse({
        surfaceId: "11111111-1111-4111-8111-111111111111",
        surfaceKind: "DIRECT",
        userId: "forged-user",
        role: "OWNER",
      }).success,
    ).toBe(false);
  });
});
