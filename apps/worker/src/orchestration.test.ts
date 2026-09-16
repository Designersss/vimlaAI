import { describe, expect, it } from "vitest";
import {
  parseInvocationExecutePayload,
  parseOrchestrationDispatchPayload,
} from "./orchestration.js";
import {
  INVOCATION_EXECUTE_QUEUE_NAME,
  invocationExecuteJobId,
  ORCHESTRATION_DISPATCH_QUEUE_NAME,
  orchestrationDispatchJobId,
} from "./queue.js";

describe("orchestration queue boundary", () => {
  it("uses stable queue names and job ids that do not expose raw internal ids", () => {
    const planId = "plan:with:separators";
    const invocationId = "plan:with:separators:inv:root";

    expect(ORCHESTRATION_DISPATCH_QUEUE_NAME).toBe("orchestration-dispatch");
    expect(INVOCATION_EXECUTE_QUEUE_NAME).toBe("invocation-execute");
    expect(orchestrationDispatchJobId(planId)).toMatch(/^orchestration-dispatch-[A-Za-z0-9_-]+$/);
    expect(invocationExecuteJobId(invocationId)).toMatch(/^invocation-execute-[A-Za-z0-9_-]+$/);
    expect(invocationExecuteJobId(invocationId)).not.toContain(invocationId);
  });

  it("strictly validates dispatch and invocation payloads", () => {
    expect(parseOrchestrationDispatchPayload({ planId: "plan-1" })).toEqual({ planId: "plan-1" });
    expect(parseInvocationExecutePayload({ planId: "plan-1", invocationId: "inv-1" })).toEqual({
      planId: "plan-1",
      invocationId: "inv-1",
    });

    expect(() => parseOrchestrationDispatchPayload({ planId: "", extra: true })).toThrow(
      "Invalid orchestration queue payload",
    );
    expect(() => parseInvocationExecutePayload({ planId: "plan-1" })).toThrow(
      "Invalid orchestration queue payload",
    );
  });
});
