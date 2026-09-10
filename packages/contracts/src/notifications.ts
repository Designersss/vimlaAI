import { z } from "zod";

export const NOTIFICATION_LIMITS = {
  pageLimitDefault: 20,
  pageLimitMax: 50,
  titleMax: 200,
  bodyMax: 400,
} as const;

export const userNotificationTypeSchema = z.enum(["REMINDER_DUE"]);
export type UserNotificationType = z.infer<typeof userNotificationTypeSchema>;

export const notificationSourceTypeSchema = z.enum(["WORKSPACE_REMINDER"]);
export type NotificationSourceType = z.infer<typeof notificationSourceTypeSchema>;

export const notificationChannelSchema = z.enum(["IN_APP", "EMAIL"]);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

export const notificationDeliveryStatusSchema = z.enum([
  "PENDING",
  "PROCESSING",
  "DELIVERED",
  "RETRYABLE",
  "FAILED",
  "SKIPPED",
]);
export type NotificationDeliveryStatus = z.infer<typeof notificationDeliveryStatusSchema>;

export const userNotificationViewSchema = z.object({
  id: z.string().uuid(),
  type: userNotificationTypeSchema,
  sourceType: notificationSourceTypeSchema,
  sourceId: z.string().uuid().nullable(),
  title: z.string(),
  body: z.string().nullable(),
  hrefPath: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  readAt: z.string().datetime({ offset: true }).nullable(),
  sourceAvailable: z.boolean(),
});
export type UserNotificationView = z.infer<typeof userNotificationViewSchema>;

export const notificationsResponseSchema = z.object({
  items: z.array(userNotificationViewSchema),
  nextCursor: z.string().nullable(),
});
export type NotificationsResponse = z.infer<typeof notificationsResponseSchema>;

export const unreadCountResponseSchema = z.object({
  count: z.number().int().min(0),
});
export type UnreadCountResponse = z.infer<typeof unreadCountResponseSchema>;

export const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(NOTIFICATION_LIMITS.pageLimitMax).default(NOTIFICATION_LIMITS.pageLimitDefault),
  cursor: z.string().min(1).max(512).optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const notificationPreferencesViewSchema = z.object({
  reminderInAppEnabled: z.boolean(),
  reminderEmailEnabled: z.boolean(),
  emailVerified: z.boolean(),
  emailAddressAvailable: z.boolean(),
});
export type NotificationPreferencesView = z.infer<typeof notificationPreferencesViewSchema>;

export const updateNotificationPreferencesSchema = z
  .object({
    reminderInAppEnabled: z.boolean().optional(),
    reminderEmailEnabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => value.reminderInAppEnabled !== undefined || value.reminderEmailEnabled !== undefined,
    { message: "At least one preference is required" },
  );
export type UpdateNotificationPreferences = z.infer<typeof updateNotificationPreferencesSchema>;

export const notificationDeliveryJobSchema = z
  .object({
    deliveryId: z.string().uuid(),
  })
  .strict();
export type NotificationDeliveryJob = z.infer<typeof notificationDeliveryJobSchema>;
