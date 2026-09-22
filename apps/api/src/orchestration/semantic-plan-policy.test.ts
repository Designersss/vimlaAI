import { describe, expect, it } from "vitest";
import type { ExecutionPlan } from "@vimla/orchestration";
import {
  applySemanticPlanExecutionPolicy,
  SemanticPlanPolicyError,
} from "./semantic-plan-policy.js";

describe("semantic plan execution policy", () => {
  it("overrides planner risk hints for Vimla with server-owned approval policy", () => {
    const plan = basePlan({
      target: { kind: "VIMLA" },
      outputs: [],
      riskClass: "READ_ONLY",
      approvalPolicy: "AUTO",
    });

    const resolved = applySemanticPlanExecutionPolicy(plan);
    expect(resolved.invocations[0]).toMatchObject({
      riskClass: "INTERNAL_WRITE",
      approvalPolicy: "USER_CONFIRMATION",
    });
  });

  it("keeps current external AI execution read-only and rejects planner side-effect hints", () => {
    const plan = basePlan({
      target: { kind: "AI_AUTO" },
      outputs: [{ name: "result", artifactType: "TEXT" }],
      riskClass: "INTERNAL_WRITE",
      approvalPolicy: "AUTO",
    });

    expect(() => applySemanticPlanExecutionPolicy(plan)).toThrowError(
      SemanticPlanPolicyError,
    );
  });

  it("rejects unsupported evaluator and image execution before persistence", () => {
    const evaluator = basePlan({
      target: { kind: "EVALUATOR" },
      outputs: [],
      riskClass: "READ_ONLY",
      approvalPolicy: "AUTO",
    });
    expect(() => applySemanticPlanExecutionPolicy(evaluator)).toThrow(
      /evaluator execution is not available/i,
    );

    const image = basePlan({
      target: { kind: "AI_MODEL", modelSlug: "image-model" },
      outputs: [{ name: "image", artifactType: "IMAGE" }],
      riskClass: "READ_ONLY",
      approvalPolicy: "AUTO",
    });
    expect(() => applySemanticPlanExecutionPolicy(image)).toThrow(
      /cannot emit this artifact type/,
    );
  });
});

function basePlan(
  invocation: Partial<ExecutionPlan["invocations"][number]> & {
    target: ExecutionPlan["invocations"][number]["target"];
  },
): ExecutionPlan {
  return {
    schemaVersion: 1,
    goal: "Policy test",
    maxParallelism: 1,
    invocations: [
      {
        id: "step-01",
        purpose: "Execute the test step",
        target: invocation.target,
        outputs: invocation.outputs ?? [],
        acceptanceCriteria: invocation.acceptanceCriteria ?? [],
        riskClass: invocation.riskClass ?? "READ_ONLY",
        approvalPolicy: invocation.approvalPolicy ?? "AUTO",
        failurePolicy: invocation.failurePolicy ?? "FAIL_PLAN",
        joinPolicy: invocation.joinPolicy ?? "ALL_REQUIRED",
      },
    ],
    dependencies: [],
  };
}
