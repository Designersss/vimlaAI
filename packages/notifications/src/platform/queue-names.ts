export const NOTIFICATIONS_QUEUE_NAME = "vimla-notifications";
export const RECONCILE_JOB_NAME = "reconcile-reminders";
export const RECONCILE_SCHEDULER_ID = "reminder-reconcile";
export const DELIVER_JOB_NAME = "deliver-notification";

export function deliveryJobId(deliveryId: string): string {
  return `notification-delivery:${deliveryId}`;
}
