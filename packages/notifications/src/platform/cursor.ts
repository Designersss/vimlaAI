import { NotificationPlatformError } from "./errors.js";

export interface NotificationCursor {
  id: string;
  t: string;
}

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeNotificationCursor(raw: string | undefined): NotificationCursor | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "id" in parsed &&
      "t" in parsed &&
      typeof parsed.id === "string" &&
      typeof parsed.t === "string"
    ) {
      return { id: parsed.id, t: parsed.t };
    }
  } catch {
    throw new NotificationPlatformError("VALIDATION_ERROR", "Invalid cursor");
  }
  throw new NotificationPlatformError("VALIDATION_ERROR", "Invalid cursor");
}
