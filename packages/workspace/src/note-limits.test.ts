import { describe, expect, it } from "vitest";
import { WORKSPACE_LIMITS } from "@vimla/contracts";
import { WorkspaceError } from "./errors.js";
import { assertNoteContentSize } from "./note-service.js";

describe("assertNoteContentSize", () => {
  it("accepts content at the limit", () => {
    expect(() => assertNoteContentSize("n".repeat(WORKSPACE_LIMITS.noteContentMax))).not.toThrow();
  });

  it("rejects oversized notes", () => {
    try {
      assertNoteContentSize("n".repeat(WORKSPACE_LIMITS.noteContentMax + 1));
      throw new Error("expected overflow");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceError);
      expect((error as WorkspaceError).code).toBe("PAYLOAD_TOO_LARGE");
    }
  });
});
