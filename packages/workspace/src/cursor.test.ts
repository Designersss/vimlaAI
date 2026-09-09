import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { WorkspaceError } from "./errors.js";

describe("workspace cursor", () => {
  it("round-trips ids", () => {
    const encoded = encodeCursor({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", t: "2026-09-09T00:00:00.000Z" });
    expect(decodeCursor(encoded)).toEqual({
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      t: "2026-09-09T00:00:00.000Z",
    });
  });

  it("rejects garbage", () => {
    expect(() => decodeCursor("%%%")).toThrow(WorkspaceError);
  });
});
