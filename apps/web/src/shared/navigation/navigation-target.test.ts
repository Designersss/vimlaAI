import { describe, expect, it } from "vitest";
import { navigationTargetToWebPath } from "./navigation-target";

describe("navigationTargetToWebPath", () => {
  it.each([
    [{ version: 1, kind: "TASKS" } as const, "/work/tasks"],
    [{ version: 1, kind: "TASK", id: "11111111-1111-4111-8111-111111111111" } as const, "/work/tasks"],
    [{ version: 1, kind: "REMINDERS" } as const, "/work/reminders"],
    [{ version: 1, kind: "REMINDER", id: "11111111-1111-4111-8111-111111111111" } as const, "/work/reminders"],
    [{ version: 1, kind: "NOTES" } as const, "/work/notes"],
    [{ version: 1, kind: "NOTE", id: "11111111-1111-4111-8111-111111111111" } as const, "/work/notes/11111111-1111-4111-8111-111111111111"],
    [{ version: 1, kind: "LISTS" } as const, "/work/lists"],
    [{ version: 1, kind: "LIST", id: "11111111-1111-4111-8111-111111111111" } as const, "/work/lists/11111111-1111-4111-8111-111111111111"],
    [{ version: 1, kind: "TODAY" } as const, "/work"],
    [{ version: 1, kind: "PROFILE" } as const, "/settings/account"],
    [{ version: 1, kind: "NOTIFICATION_SETTINGS" } as const, "/settings/notifications"],
  ])("maps %o", (target, expected) => {
    expect(navigationTargetToWebPath(target)).toBe(expected);
  });
});
