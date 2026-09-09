import { WorkspaceError } from "./errors.js";

export type TaskListGroup = "a" | "f";

export interface TaskListCursor {
  g: TaskListGroup;
  due: string;
  u: string;
  c: string;
  id: string;
}

export interface TaskSortFields {
  id: string;
  status: string;
  dueAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export function isActiveTaskStatus(status: string): boolean {
  return status === "TODO" || status === "IN_PROGRESS";
}

export function taskListGroupStart(group: TaskListGroup): TaskListCursor {
  return { g: group, due: "", u: "", c: "", id: "" };
}

export function isTaskListGroupStart(cursor: TaskListCursor): boolean {
  return cursor.due === "" && cursor.u === "" && cursor.c === "" && cursor.id === "";
}

function isIsoTimestamp(value: string): boolean {
  return value !== "" && !Number.isNaN(Date.parse(value));
}

export function compareActiveTasks(left: TaskSortFields, right: TaskSortFields): number {
  const leftDue = left.dueAt;
  const rightDue = right.dueAt;
  if (Boolean(leftDue) !== Boolean(rightDue)) {
    return leftDue ? -1 : 1;
  }
  if (leftDue && rightDue && leftDue !== rightDue) {
    return leftDue < rightDue ? -1 : 1;
  }
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt > right.updatedAt ? -1 : 1;
  }
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? -1 : 1;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
}

export function compareFinishedTasks(left: TaskSortFields, right: TaskSortFields): number {
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt > right.updatedAt ? -1 : 1;
  }
  if (left.createdAt !== right.createdAt) {
    return left.createdAt > right.createdAt ? -1 : 1;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id > right.id ? -1 : 1;
}

export function compareTasksForDefaultList(left: TaskSortFields, right: TaskSortFields): number {
  const leftActive = isActiveTaskStatus(left.status);
  const rightActive = isActiveTaskStatus(right.status);
  if (leftActive !== rightActive) {
    return leftActive ? -1 : 1;
  }
  return leftActive ? compareActiveTasks(left, right) : compareFinishedTasks(left, right);
}

export function encodeTaskCursor(cursor: TaskListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeTaskCursor(raw: string | undefined): TaskListCursor | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "g" in parsed &&
      "due" in parsed &&
      "u" in parsed &&
      "c" in parsed &&
      "id" in parsed &&
      (parsed.g === "a" || parsed.g === "f") &&
      typeof parsed.due === "string" &&
      typeof parsed.u === "string" &&
      typeof parsed.c === "string" &&
      typeof parsed.id === "string"
    ) {
      const cursor = { g: parsed.g, due: parsed.due, u: parsed.u, c: parsed.c, id: parsed.id } as const;
      if (isTaskListGroupStart(cursor)) {
        return cursor;
      }
      if (
        (cursor.due === "" || isIsoTimestamp(cursor.due)) &&
        isIsoTimestamp(cursor.u) &&
        isIsoTimestamp(cursor.c) &&
        cursor.id.length > 0
      ) {
        return cursor;
      }
    }
  } catch {
    throw new WorkspaceError("VALIDATION_ERROR", "Invalid cursor");
  }
  throw new WorkspaceError("VALIDATION_ERROR", "Invalid cursor");
}
