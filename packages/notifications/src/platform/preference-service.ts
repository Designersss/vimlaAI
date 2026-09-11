import type { Prisma, PrismaClient } from "@vimla/database";
import type { NotificationPreferencesView, UpdateNotificationPreferences } from "@vimla/contracts";
import type { VimlaLocale } from "@vimla/shared";
import { NotificationPlatformError } from "./errors.js";
import { DEFAULT_REMINDER_PREFERENCES } from "./preferences.js";

type NotificationPreferenceDb = PrismaClient | Prisma.TransactionClient;

export class NotificationPreferenceService {
  constructor(private readonly db: NotificationPreferenceDb) {}

  async get(userId: string): Promise<NotificationPreferencesView> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: { preference: true },
    });
    if (!user) {
      throw new NotificationPlatformError("NOT_FOUND", "User not found");
    }
    const stored = user.preference;
    return {
      reminderInAppEnabled: stored?.reminderInAppEnabled ?? DEFAULT_REMINDER_PREFERENCES.inAppEnabled,
      reminderEmailEnabled: stored?.reminderEmailEnabled ?? DEFAULT_REMINDER_PREFERENCES.emailEnabled,
      emailVerified: user.emailVerified,
      emailAddressAvailable: user.emailVerified && user.email.length > 0,
    };
  }

  async update(
    userId: string,
    input: UpdateNotificationPreferences,
    defaultLocale: VimlaLocale,
  ): Promise<NotificationPreferencesView> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: { preference: true },
    });
    if (!user) {
      throw new NotificationPlatformError("NOT_FOUND", "User not found");
    }
    if (input.reminderEmailEnabled === true && !user.emailVerified) {
      throw new NotificationPlatformError("EMAIL_UNVERIFIED", "Verified email is required for email reminders");
    }

    const current = await this.get(userId);
    await this.db.userPreference.upsert({
      where: { userId },
      create: {
        userId,
        locale: defaultLocale,
        reminderInAppEnabled: input.reminderInAppEnabled ?? current.reminderInAppEnabled,
        reminderEmailEnabled: input.reminderEmailEnabled ?? current.reminderEmailEnabled,
      },
      update: {
        ...(input.reminderInAppEnabled !== undefined
          ? { reminderInAppEnabled: input.reminderInAppEnabled }
          : {}),
        ...(input.reminderEmailEnabled !== undefined
          ? { reminderEmailEnabled: input.reminderEmailEnabled }
          : {}),
      },
    });
    return this.get(userId);
  }
}
