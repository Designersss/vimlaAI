import type { NavigationTarget } from "@vimla/contracts";

export function navigationTargetToWebPath(target: NavigationTarget): string {
  switch (target.kind) {
    case "TASKS":
    case "TASK":
      return "/work/tasks";
    case "REMINDERS":
    case "REMINDER":
      return "/work/reminders";
    case "NOTES":
      return "/work/notes";
    case "NOTE":
      return `/work/notes/${target.id}`;
    case "LISTS":
      return "/work/lists";
    case "LIST":
      return `/work/lists/${target.id}`;
    case "TODAY":
      return "/work";
    case "PROFILE":
      return "/settings/account";
    case "NOTIFICATION_SETTINGS":
      return "/settings/notifications";
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
}
