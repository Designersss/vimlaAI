import type { NavigationTarget } from "@vimla/contracts";

export function reminderNavigationTarget(reminderId: string): NavigationTarget {
  return { version: 1, kind: "REMINDER", id: reminderId };
}
