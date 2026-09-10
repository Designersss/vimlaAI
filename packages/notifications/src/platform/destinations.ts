const ALLOWED_HREF_PATHS = new Set(["/work/reminders"]);

export const REMINDER_HREF_PATH = "/work/reminders";

export function reminderHrefPath(): string {
  return REMINDER_HREF_PATH;
}

export function sanitizeHrefPath(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return ALLOWED_HREF_PATHS.has(value) ? value : null;
}

export function reminderOpenUrl(webOrigin: string): string | undefined {
  const origin = webOrigin.replace(/\/$/, "");
  if (!origin.startsWith("http://") && !origin.startsWith("https://")) {
    return undefined;
  }
  return `${origin}${REMINDER_HREF_PATH}`;
}
