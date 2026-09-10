export interface ReminderChannelPreferences {
  inAppEnabled: boolean;
  emailEnabled: boolean;
}

export const DEFAULT_REMINDER_PREFERENCES: ReminderChannelPreferences = {
  inAppEnabled: true,
  emailEnabled: false,
};

export function resolveReminderPreferences(stored: {
  reminderInAppEnabled?: boolean | null;
  reminderEmailEnabled?: boolean | null;
} | null | undefined): ReminderChannelPreferences {
  return {
    inAppEnabled: stored?.reminderInAppEnabled ?? DEFAULT_REMINDER_PREFERENCES.inAppEnabled,
    emailEnabled: stored?.reminderEmailEnabled ?? DEFAULT_REMINDER_PREFERENCES.emailEnabled,
  };
}

export function desiredReminderChannels(preferences: ReminderChannelPreferences): Array<"IN_APP" | "EMAIL"> {
  const channels: Array<"IN_APP" | "EMAIL"> = [];
  if (preferences.inAppEnabled) {
    channels.push("IN_APP");
  }
  if (preferences.emailEnabled) {
    channels.push("EMAIL");
  }
  return channels;
}
