import { isPastMaxLateness } from "./late-policy.js";
import type { ReminderChannelPreferences } from "./preferences.js";
import { reminderOccurrenceKey } from "./occurrence-key.js";

export type DeliverySkipReason =
  | "canceled"
  | "rescheduled"
  | "archived"
  | "deleted"
  | "expired"
  | "preference_disabled"
  | "source_unavailable"
  | "no_verified_email"
  | "invalid";

export interface ReminderSourceState {
  reminderId: string;
  ownerUserId: string;
  status: string;
  scheduledAt: Date;
  timezone: string;
  title: string;
  description: string | null;
  archivedAt: Date | null;
  deletedAt: Date | null;
}

export function evaluateReminderDelivery(input: {
  deliveryUserId: string;
  channel: "IN_APP" | "EMAIL";
  occurrenceKey: string;
  scheduledFor: Date;
  now: Date;
  maxLatenessMinutes: number;
  reminder: ReminderSourceState | null;
  preferences: ReminderChannelPreferences;
  emailVerified: boolean;
  hasEmail: boolean;
}): { action: "deliver" } | { action: "skip"; reason: DeliverySkipReason } {
  if (!input.reminder) {
    return { action: "skip", reason: "source_unavailable" };
  }
  if (input.reminder.deletedAt) {
    return { action: "skip", reason: "deleted" };
  }
  if (input.reminder.archivedAt) {
    return { action: "skip", reason: "archived" };
  }
  if (input.reminder.ownerUserId !== input.deliveryUserId) {
    return { action: "skip", reason: "source_unavailable" };
  }
  if (input.reminder.status === "CANCELED") {
    return { action: "skip", reason: "canceled" };
  }
  if (input.reminder.status !== "PENDING" && input.reminder.status !== "DELIVERED") {
    return { action: "skip", reason: "invalid" };
  }
  const currentKey = reminderOccurrenceKey(input.reminder.reminderId, input.reminder.scheduledAt);
  if (currentKey !== input.occurrenceKey) {
    return { action: "skip", reason: "rescheduled" };
  }
  if (isPastMaxLateness({
    scheduledFor: input.scheduledFor,
    now: input.now,
    maxLatenessMinutes: input.maxLatenessMinutes,
  })) {
    return { action: "skip", reason: "expired" };
  }
  if (input.channel === "IN_APP" && !input.preferences.inAppEnabled) {
    return { action: "skip", reason: "preference_disabled" };
  }
  if (input.channel === "EMAIL" && !input.preferences.emailEnabled) {
    return { action: "skip", reason: "preference_disabled" };
  }
  if (input.channel === "EMAIL" && (!input.emailVerified || !input.hasEmail)) {
    return { action: "skip", reason: "no_verified_email" };
  }
  return { action: "deliver" };
}
