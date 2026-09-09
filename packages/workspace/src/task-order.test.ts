import { describe, expect, it } from "vitest";
import {
  compareTasksForDefaultList,
  decodeTaskCursor,
  encodeTaskCursor,
  type TaskSortFields,
} from "./task-order.js";

function task(overrides: Partial<TaskSortFields> & Pick<TaskSortFields, "id" | "status">): TaskSortFields {
  return {
    dueAt: null,
    updatedAt: "2026-09-09T12:00:00.000Z",
    createdAt: "2026-09-09T10:00:00.000Z",
    ...overrides,
  };
}

describe("default task ordering", () => {
  it("places TODO and IN_PROGRESS before DONE and CANCELED", () => {
    const items = [
      task({ id: "done", status: "DONE", updatedAt: "2026-09-09T18:00:00.000Z" }),
      task({ id: "todo", status: "TODO" }),
      task({ id: "canceled", status: "CANCELED", updatedAt: "2026-09-09T19:00:00.000Z" }),
      task({ id: "progress", status: "IN_PROGRESS" }),
    ];
    const ordered = [...items].sort(compareTasksForDefaultList).map((entry) => entry.id);
    expect(ordered.slice(0, 2).sort()).toEqual(["progress", "todo"]);
    expect(ordered.slice(2)).toEqual(["canceled", "done"]);
  });

  it("orders earlier dueAt first and undated active tasks after dated ones", () => {
    const earlier = task({
      id: "earlier",
      status: "TODO",
      dueAt: "2026-09-10T00:00:00.000Z",
    });
    const later = task({
      id: "later",
      status: "IN_PROGRESS",
      dueAt: "2026-09-11T00:00:00.000Z",
    });
    const undated = task({ id: "undated", status: "TODO" });
    const ordered = [undated, later, earlier].sort(compareTasksForDefaultList).map((entry) => entry.id);
    expect(ordered).toEqual(["earlier", "later", "undated"]);
  });

  it("uses updatedAt then createdAt then id as a stable fallback", () => {
    const newer = task({
      id: "b",
      status: "TODO",
      updatedAt: "2026-09-09T13:00:00.000Z",
      createdAt: "2026-09-09T09:00:00.000Z",
    });
    const older = task({
      id: "a",
      status: "TODO",
      updatedAt: "2026-09-09T12:00:00.000Z",
      createdAt: "2026-09-09T08:00:00.000Z",
    });
    expect(compareTasksForDefaultList(newer, older)).toBe(-1);

    const sameUpdateNewerCreate = task({
      id: "c",
      status: "TODO",
      updatedAt: "2026-09-09T12:00:00.000Z",
      createdAt: "2026-09-09T11:00:00.000Z",
    });
    const sameUpdateOlderCreate = task({
      id: "d",
      status: "TODO",
      updatedAt: "2026-09-09T12:00:00.000Z",
      createdAt: "2026-09-09T10:00:00.000Z",
    });
    expect(compareTasksForDefaultList(sameUpdateOlderCreate, sameUpdateNewerCreate)).toBe(-1);

    const left = task({ id: "aaa", status: "TODO", updatedAt: "2026-09-09T12:00:00.000Z", createdAt: "2026-09-09T10:00:00.000Z" });
    const right = task({ id: "bbb", status: "TODO", updatedAt: "2026-09-09T12:00:00.000Z", createdAt: "2026-09-09T10:00:00.000Z" });
    expect(compareTasksForDefaultList(left, right)).toBe(-1);
  });

  it("orders finished tasks by recent updatedAt with a stable id tie-breaker", () => {
    const recent = task({ id: "z", status: "DONE", updatedAt: "2026-09-09T16:00:00.000Z" });
    const older = task({ id: "a", status: "CANCELED", updatedAt: "2026-09-09T15:00:00.000Z" });
    expect(compareTasksForDefaultList(recent, older)).toBe(-1);
    const sameTimeLeft = task({ id: "m", status: "DONE", updatedAt: "2026-09-09T16:00:00.000Z", createdAt: "2026-09-09T10:00:00.000Z" });
    const sameTimeRight = task({ id: "n", status: "DONE", updatedAt: "2026-09-09T16:00:00.000Z", createdAt: "2026-09-09T10:00:00.000Z" });
    expect(compareTasksForDefaultList(sameTimeLeft, sameTimeRight)).toBe(1);
  });

  it("round-trips task cursors", () => {
    const cursor = { g: "a" as const, due: "2026-09-10T00:00:00.000Z", u: "2026-09-09T12:00:00.000Z", c: "2026-09-09T10:00:00.000Z", id: "task-1" };
    expect(decodeTaskCursor(encodeTaskCursor(cursor))).toEqual(cursor);
  });

  it("round-trips the finished-group start cursor and rejects legacy updatedAt cursors", () => {
    const start = { g: "f" as const, due: "", u: "", c: "", id: "" };
    expect(decodeTaskCursor(encodeTaskCursor(start))).toEqual(start);
    const legacy = Buffer.from(JSON.stringify({ id: "x", t: "2026-09-09T12:00:00.000Z" }), "utf8").toString("base64url");
    expect(() => decodeTaskCursor(legacy)).toThrow();
  });
});
