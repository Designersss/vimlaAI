export const MAINTENANCE_QUEUE_NAME = "vimla-maintenance";
export {
  DELIVER_JOB_NAME,
  NOTIFICATIONS_QUEUE_NAME,
  RECONCILE_JOB_NAME,
  RECONCILE_SCHEDULER_ID,
  deliveryJobId,
} from "@vimla/notifications";

export function redisConnectionOptions(redisUrl: string): {
  url: string;
  maxRetriesPerRequest: null;
} {
  return {
    url: redisUrl,
    maxRetriesPerRequest: null,
  };
}

export function isDuplicateJobError(error: unknown): boolean {
  return error instanceof Error && /already exists|Job with this? id/i.test(error.message);
}
