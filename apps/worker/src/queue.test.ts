import { describe, expect, it } from "vitest";
import { deliveryJobId, NOTIFICATIONS_QUEUE_NAME, RECONCILE_SCHEDULER_ID } from "@vimla/notifications";
import {
  INVOCATION_EXECUTE_JOB_NAME,
  INVOCATION_EXECUTE_QUEUE_NAME,
  MAINTENANCE_QUEUE_NAME,
  ORCHESTRATION_DISPATCH_JOB_NAME,
  ORCHESTRATION_DISPATCH_QUEUE_NAME,
  ORCHESTRATION_RECONCILE_JOB_NAME,
  ORCHESTRATION_RECONCILE_SCHEDULER_ID,
  redisConnectionOptions,
} from "./queue.js";

describe("worker queue foundation", () => {
  it("uses a maintenance queue rather than generation workloads", () => {
    expect(MAINTENANCE_QUEUE_NAME).toBe("vimla-maintenance");
  });

  it("uses a dedicated notifications queue with stable delivery job ids", () => {
    expect(NOTIFICATIONS_QUEUE_NAME).toBe("vimla-notifications");
    expect(deliveryJobId("11111111-1111-4111-8111-111111111111")).toBe(
      "notification-delivery-11111111-1111-4111-8111-111111111111",
    );
    expect(RECONCILE_SCHEDULER_ID).toBe("reminder-reconcile");
  });

  it("declares separate orchestration dispatch and execution queues", () => {
    expect(ORCHESTRATION_DISPATCH_QUEUE_NAME).toBe("orchestration-dispatch");
    expect(INVOCATION_EXECUTE_QUEUE_NAME).toBe("invocation-execute");
    expect(ORCHESTRATION_DISPATCH_JOB_NAME).toBe("orchestration-dispatch");
    expect(INVOCATION_EXECUTE_JOB_NAME).toBe("invocation-execute");
    expect(ORCHESTRATION_RECONCILE_JOB_NAME).toBe("orchestration-reconcile");
    expect(ORCHESTRATION_RECONCILE_SCHEDULER_ID).toBe("orchestration-reconcile-v1");
  });

  it("disables ioredis request retries for BullMQ", () => {
    expect(redisConnectionOptions("redis://localhost:6379").maxRetriesPerRequest).toBeNull();
  });
});
