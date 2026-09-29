import { NAVIGATION_TARGET_VERSION, type NavigationTarget } from "@vimla/contracts";

export function reminderNavigationTarget(reminderId: string): NavigationTarget {
  return { version: NAVIGATION_TARGET_VERSION, kind: "REMINDER", id: reminderId };
}
