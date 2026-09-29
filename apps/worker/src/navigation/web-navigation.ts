import type { NavigationTarget } from "@vimla/contracts";

export function navigationTargetToWebUrl(
  webOrigin: string,
  target: NavigationTarget,
): string | undefined {
  const path = target.kind === "REMINDER" || target.kind === "REMINDERS"
    ? "/work/reminders"
    : undefined;
  if (!path) {
    return undefined;
  }
  try {
    const origin = new URL(webOrigin);
    if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) {
      return undefined;
    }
    return new URL(path, origin).toString();
  } catch {
    return undefined;
  }
}
