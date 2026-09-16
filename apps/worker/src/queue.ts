export const MAINTENANCE_QUEUE_NAME = "vimla-maintenance";
export const ORCHESTRATION_DISPATCH_QUEUE_NAME = "orchestration-dispatch";
export const INVOCATION_EXECUTE_QUEUE_NAME = "invocation-execute";
export const ORCHESTRATION_DISPATCH_JOB_NAME = "orchestration-dispatch";
export const INVOCATION_EXECUTE_JOB_NAME = "invocation-execute";
export const ORCHESTRATION_RECONCILE_JOB_NAME = "orchestration-reconcile";
export const ORCHESTRATION_RECONCILE_SCHEDULER_ID = "orchestration-reconcile-v1";
export const ORCHESTRATION_RECONCILE_INTERVAL_MS = 15_000;

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

export function orchestrationDispatchJobId(planId: string): string {
  return `orchestration-dispatch-${encodeJobKey(planId)}`;
}

export function invocationExecuteJobId(invocationId: string): string {
  return `invocation-execute-${encodeJobKey(invocationId)}`;
}

export function isDuplicateJobError(error: unknown): boolean {
  return error instanceof Error && /already exists|Job with this? id/i.test(error.message);
}

function encodeJobKey(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
