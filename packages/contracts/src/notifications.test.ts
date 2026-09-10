import { describe, expect, it } from "vitest";
import { updateNotificationPreferencesSchema, userNotificationViewSchema } from "./notifications.js";

describe("notification public DTOs", () => {
  it("rejects client-supplied userId on preference updates", () => {
    const result = updateNotificationPreferencesSchema.safeParse({
      reminderInAppEnabled: true,
      userId: "other-user",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty preference patches", () => {
    expect(updateNotificationPreferencesSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a safe in-app notification view", () => {
    const parsed = userNotificationViewSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      type: "REMINDER_DUE",
      sourceType: "WORKSPACE_REMINDER",
      sourceId: "22222222-2222-4222-8222-222222222222",
      title: "Call dentist",
      body: null,
      hrefPath: "/work/reminders",
      createdAt: "2026-09-10T12:00:00.000Z",
      readAt: null,
      sourceAvailable: true,
    });
    expect(parsed.hrefPath).toBe("/work/reminders");
  });
});
