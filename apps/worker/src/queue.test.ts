import { describe, expect, it } from "vitest";
import { MAINTENANCE_QUEUE_NAME, redisConnectionOptions } from "./queue.js";

describe("worker queue foundation", () => {
  it("uses a maintenance queue rather than generation workloads", () => {
    expect(MAINTENANCE_QUEUE_NAME).toBe("vimla-maintenance");
  });

  it("disables ioredis request retries for BullMQ", () => {
    expect(redisConnectionOptions("redis://localhost:6379").maxRetriesPerRequest).toBeNull();
  });
});
