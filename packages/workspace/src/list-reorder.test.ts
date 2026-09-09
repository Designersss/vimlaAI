import { describe, expect, it } from "vitest";
import { WorkspaceError } from "./errors.js";
import { assertReorderIds } from "./list-service.js";

describe("assertReorderIds", () => {
  it("accepts a permutation of the current ids", () => {
    expect(() => assertReorderIds(["a", "b", "c"], ["c", "a", "b"])).not.toThrow();
  });

  it("rejects missing, extra, or duplicate ids", () => {
    expect(() => assertReorderIds(["a", "b"], ["a"])).toThrow(WorkspaceError);
    expect(() => assertReorderIds(["a", "b"], ["a", "b", "c"])).toThrow(WorkspaceError);
    expect(() => assertReorderIds(["a", "b"], ["a", "a"])).toThrow(WorkspaceError);
    try {
      assertReorderIds(["a", "b"], ["a"]);
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceError);
      expect((error as WorkspaceError).code).toBe("REORDER_INVALID");
    }
  });
});
