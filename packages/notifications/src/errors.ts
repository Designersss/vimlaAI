import type { NotificationErrorCategory } from "./types.js";

export class NotificationDeliveryError extends Error {
  readonly category: NotificationErrorCategory;

  constructor(category: NotificationErrorCategory, message: string) {
    super(message);
    this.name = "NotificationDeliveryError";
    this.category = category;
  }
}

export class NotificationAbuseError extends Error {
  constructor() {
    super("Notification delivery is rate limited");
    this.name = "NotificationAbuseError";
  }
}

export function isNotificationDeliveryError(
  error: unknown,
): error is NotificationDeliveryError {
  return error instanceof NotificationDeliveryError;
}

export function isNotificationAbuseError(error: unknown): error is NotificationAbuseError {
  return error instanceof NotificationAbuseError;
}

export function deliveryErrorCategory(error: unknown): NotificationErrorCategory {
  if (isNotificationDeliveryError(error)) {
    return error.category;
  }
  if (isNotificationAbuseError(error)) {
    return "abuse";
  }
  return "ambiguous";
}
