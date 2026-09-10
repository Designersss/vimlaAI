import { describe, expect, it } from "vitest";
import { desiredReminderChannels, resolveReminderPreferences } from "./preferences.js";

describe("notification preference resolution", () => {
  it("defaults in-app on and email off", () => {
    expect(resolveReminderPreferences(null)).toEqual({ inAppEnabled: true, emailEnabled: false });
    expect(desiredReminderChannels(resolveReminderPreferences(undefined))).toEqual(["IN_APP"]);
  });

  it("honors stored flags", () => {
    expect(
      desiredReminderChannels(
        resolveReminderPreferences({ reminderInAppEnabled: true, reminderEmailEnabled: true }),
      ),
    ).toEqual(["IN_APP", "EMAIL"]);
    expect(
      desiredReminderChannels(
        resolveReminderPreferences({ reminderInAppEnabled: false, reminderEmailEnabled: false }),
      ),
    ).toEqual([]);
  });
});
