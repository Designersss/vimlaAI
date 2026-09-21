import { describe, expect, it } from "vitest";
import {
  FailClosedInvocationExecutorRegistry,
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

  it("fails closed for evaluator targets until evaluator runtime exists", async () => {
    const executor = new FailClosedInvocationExecutorRegistry();
    await expect(
      executor.execute({
        planId: "plan-1",
        invocationId: "inv-1",
        attempt: 1,
        runId: "run-1",
        idempotencyKey: "run-1",
        target: {
          kind: "EVALUATOR",
          modelSlug: null,
          agentId: null,
        },
      }),
    ).resolves.toEqual({
      status: "FAILED",
      errorCode: "EVALUATOR_NOT_IMPLEMENTED",
      retryable: false,
    });
  });

  it("fails closed for future agent targets until agent runtime exists", async () => {
    const executor = new FailClosedInvocationExecutorRegistry();
    await expect(
      executor.execute({
        planId: "plan-1",
        invocationId: "inv-agent",
        attempt: 1,
        runId: "run-agent",
        idempotencyKey: "run-agent",
        target: {
          kind: "AGENT",
          modelSlug: null,
          agentId: "future-agent",
        },
      }),
    ).resolves.toEqual({
      status: "FAILED",
      errorCode: "AGENT_NOT_IMPLEMENTED",
      retryable: false,
    });
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
