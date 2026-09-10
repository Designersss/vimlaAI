import { describe, expect, it } from "vitest";
import { evaluateReminderDelivery, type ReminderSourceState } from "./eligibility.js";
import { reminderOccurrenceKey } from "./occurrence-key.js";

const scheduledAt = new Date("2026-09-10T12:00:00.000Z");

function reminder(overrides: Partial<ReminderSourceState> = {}): ReminderSourceState {
  return {
    reminderId: "11111111-1111-4111-8111-111111111111",
    ownerUserId: "user-a",
    status: "PENDING",
    scheduledAt,
    timezone: "Europe/Moscow",
    title: "Call",
    description: null,
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

describe("delivery eligibility", () => {
  it("delivers a current pending reminder", () => {
    const source = reminder();
    const result = evaluateReminderDelivery({
      deliveryUserId: "user-a",
      channel: "IN_APP",
      occurrenceKey: reminderOccurrenceKey(source.reminderId, source.scheduledAt),
      scheduledFor: scheduledAt,
      now: new Date("2026-09-10T12:00:30.000Z"),
      maxLatenessMinutes: 1440,
      reminder: source,
      preferences: { inAppEnabled: true, emailEnabled: true },
      emailVerified: true,
      hasEmail: true,
    });
    expect(result).toEqual({ action: "deliver" });
  });

  it("skips canceled, rescheduled, archived, deleted and stale sources", () => {
    const source = reminder();
    const base = {
      deliveryUserId: "user-a",
      channel: "IN_APP" as const,
      occurrenceKey: reminderOccurrenceKey(source.reminderId, source.scheduledAt),
      scheduledFor: scheduledAt,
      now: new Date("2026-09-10T12:00:30.000Z"),
      maxLatenessMinutes: 1440,
      preferences: { inAppEnabled: true, emailEnabled: true },
      emailVerified: true,
      hasEmail: true,
    };
    expect(evaluateReminderDelivery({ ...base, reminder: reminder({ status: "CANCELED" }) }).action).toBe("skip");
    expect(
      evaluateReminderDelivery({
        ...base,
        reminder: reminder({ scheduledAt: new Date("2026-09-10T14:00:00.000Z") }),
      }),
    ).toMatchObject({ reason: "rescheduled" });
    expect(evaluateReminderDelivery({ ...base, reminder: reminder({ archivedAt: new Date() }) })).toMatchObject({
      reason: "archived",
    });
    expect(evaluateReminderDelivery({ ...base, reminder: reminder({ deletedAt: new Date() }) })).toMatchObject({
      reason: "deleted",
    });
    expect(evaluateReminderDelivery({ ...base, reminder: null })).toMatchObject({ reason: "source_unavailable" });
  });

  it("skips disabled preferences and unverified email", () => {
    const source = reminder();
    const occurrenceKey = reminderOccurrenceKey(source.reminderId, source.scheduledAt);
    expect(
      evaluateReminderDelivery({
        deliveryUserId: "user-a",
        channel: "EMAIL",
        occurrenceKey,
        scheduledFor: scheduledAt,
        now: new Date("2026-09-10T12:00:30.000Z"),
        maxLatenessMinutes: 1440,
        reminder: source,
        preferences: { inAppEnabled: true, emailEnabled: false },
        emailVerified: true,
        hasEmail: true,
      }),
    ).toMatchObject({ reason: "preference_disabled" });
    expect(
      evaluateReminderDelivery({
        deliveryUserId: "user-a",
        channel: "EMAIL",
        occurrenceKey,
        scheduledFor: scheduledAt,
        now: new Date("2026-09-10T12:00:30.000Z"),
        maxLatenessMinutes: 1440,
        reminder: source,
        preferences: { inAppEnabled: true, emailEnabled: true },
        emailVerified: false,
        hasEmail: true,
      }),
    ).toMatchObject({ reason: "no_verified_email" });
  });
});
