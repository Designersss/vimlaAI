export type {
  EmailMessage,
  EmailProvider,
  EmailSendResult,
  EmailTemplateId,
  NotificationAbuseLimits,
  NotificationCoordinationStore,
  NotificationDelivery,
  NotificationErrorCategory,
  NotificationInbox,
  SanitizedNotificationEvent,
} from "./types.js";
export { renderEmailTemplate } from "./templates.js";
export {
  MemoryNotificationInbox,
  memoryNotificationInbox,
} from "./memory-inbox.js";
export { MemoryEmailProvider } from "./memory-provider.js";
export { LoggingEmailProvider } from "./logging-provider.js";
export { SmtpEmailProvider } from "./smtp-email-provider.js";
export { NotificationService } from "./service.js";
export { NotificationMetrics } from "./metrics.js";
export { MemoryNotificationStore, redisNotificationStore } from "./store.js";
export {
  NotificationAbuseError,
  NotificationDeliveryError,
  isNotificationAbuseError,
  isNotificationDeliveryError,
} from "./errors.js";
export {
  createNotificationService,
  isDevNotificationInboxEnabled,
  type EmailAdapterConfig,
} from "./factory.js";
export { NotificationPlatformError, isNotificationPlatformError } from "./platform/errors.js";
export { reminderOccurrenceKey, scheduledInstantFromOccurrenceKey } from "./platform/occurrence-key.js";
export { isPastMaxLateness } from "./platform/late-policy.js";
export { classifyDeliveryError, nextAttemptAt, shouldRetry } from "./platform/retry-policy.js";
export {
  DEFAULT_REMINDER_PREFERENCES,
  desiredReminderChannels,
  resolveReminderPreferences,
} from "./platform/preferences.js";
export { evaluateReminderDelivery } from "./platform/eligibility.js";
export { formatReminderInstant } from "./platform/format-time.js";
export { sanitizeUserText } from "./platform/text.js";
export { reminderHrefPath, reminderOpenUrl, sanitizeHrefPath } from "./platform/destinations.js";
export { NotificationInboxService } from "./platform/inbox-service.js";
export { NotificationPreferenceService } from "./platform/preference-service.js";
export { ReminderReconciler } from "./platform/reconciler.js";
export { NotificationDeliveryProcessor } from "./platform/delivery-processor.js";
export type { ReminderEmailSendInput } from "./platform/delivery-processor.js";
export type { ReminderReconcileCounters } from "./platform/reconciler.js";
export type { PlatformLogger } from "./platform/logger.js";
export { silentPlatformLogger } from "./platform/logger.js";
export {
  deliveryJobId,
  NOTIFICATIONS_QUEUE_NAME,
  RECONCILE_JOB_NAME,
  RECONCILE_SCHEDULER_ID,
  DELIVER_JOB_NAME,
} from "./platform/queue-names.js";
