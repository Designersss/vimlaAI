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

  it("enables typed evaluator modes and still rejects unsupported AI image execution", () => {
    const deterministic = basePlan({
      target: { kind: "EVALUATOR" },
      outputs: [{ name: "evaluation", artifactType: "JSON" }],
      acceptanceCriteria: [
        {
          id: "quality",
          description: "Artifact must exist",
          mode: "DETERMINISTIC",
          binding: {
            kind: "ARTIFACT_EXISTS",
            inputName: "candidate",
          },
        },
      ],
      riskClass: "FINANCIAL",
      approvalPolicy: "USER_CONFIRMATION",
    });
    expect(
      applySemanticPlanExecutionPolicy(deterministic).invocations[0],
    ).toMatchObject({
      riskClass: "READ_ONLY",
      approvalPolicy: "AUTO",
    });

    const human = basePlan({
      target: { kind: "EVALUATOR" },
      outputs: [{ name: "evaluation", artifactType: "JSON" }],
      acceptanceCriteria: [
        {
          id: "review",
          description: "Human reviewer approves the result",
          mode: "HUMAN_APPROVAL",
        },
      ],
    });
    expect(
      applySemanticPlanExecutionPolicy(human).invocations[0],
    ).toMatchObject({
      riskClass: "READ_ONLY",
      approvalPolicy: "HUMAN_APPROVAL",
    });

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

  it("rejects malformed evaluator contracts", () => {
    const missingBinding = basePlan({
      target: { kind: "EVALUATOR" },
      outputs: [{ name: "evaluation", artifactType: "JSON" }],
      acceptanceCriteria: [
        {
          id: "quality",
          description: "Artifact must exist",
          mode: "DETERMINISTIC",
        },
      ],
    });
    expect(() => applySemanticPlanExecutionPolicy(missingBinding)).toThrow(
      /require explicit artifact bindings/,
    );

    const mixedModes = basePlan({
      target: { kind: "EVALUATOR" },
      outputs: [{ name: "evaluation", artifactType: "JSON" }],
      acceptanceCriteria: [
        {
          id: "one",
          description: "One",
          mode: "AI_EVALUATOR",
        },
        {
          id: "two",
          description: "Two",
          mode: "HUMAN_APPROVAL",
        },
      ],
    });
    expect(() => applySemanticPlanExecutionPolicy(mixedModes)).toThrow(
      /cannot mix evaluation modes/,
    );
  });
  it("rejects multiple human approval criteria in v1", () => {
    expect(() =>
      applySemanticPlanExecutionPolicy(
        planWithInvocation({
          target: { kind: "EVALUATOR" },
          outputs: [{ name: "evaluation", artifactType: "JSON" }],
          acceptanceCriteria: [
            {
              id: "quality",
              description: "Quality is acceptable",
              mode: "HUMAN_APPROVAL",
            },
            {
              id: "safety",
              description: "Safety is acceptable",
              mode: "HUMAN_APPROVAL",
            },
          ],
        }),
      ),
    ).toThrow(SemanticPlanPolicyError);
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
