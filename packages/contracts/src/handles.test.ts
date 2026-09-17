import { describe, expect, it } from "vitest";
import {
  HANDLE_MAX_LENGTH,
  handleInputSchema,
  handleSchema,
  normalizeHandleInput,
} from "./handles.js";

describe("handle contracts", () => {
  it("normalizes a single leading @ and uppercase characters", () => {
    expect(normalizeHandleInput("@DeNiS_01")).toBe("denis_01");
    expect(handleInputSchema.parse("@DeNiS_01")).toBe("denis_01");
  });

  it("accepts canonical lowercase handles", () => {
    expect(handleSchema.parse("denis")).toBe("denis");
    expect(handleSchema.parse("denis.petrov_01")).toBe("denis.petrov_01");
  });

  it.each([
    "ab",
    "Denis",
    " denis",
    "denis ",
    "_denis",
    "denis_",
    ".denis",
    "denis.",
    "denis..petrov",
    "denis__petrov",
    "denis._petrov",
    "денис",
    "denis-petrov",
  ])("rejects non-canonical handle %s", (value) => {
    expect(handleSchema.safeParse(value).success).toBe(false);
  });

  it("enforces the maximum length", () => {
    expect(handleSchema.safeParse("a".repeat(HANDLE_MAX_LENGTH)).success).toBe(true);
    expect(handleSchema.safeParse("a".repeat(HANDLE_MAX_LENGTH + 1)).success).toBe(false);
  });
});
