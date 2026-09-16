import { describe, expect, it } from "vitest";
import { executionPlanSchema, parseExecutionPlan } from "./plan-schema.js";
import type { InvocationTarget } from "./targets.js";
import type { ExecutionPlan, Invocation } from "./types.js";

function invocation(id: string, target: InvocationTarget, overrides: Partial<Invocation> = {}): Invocation {
  return {
    id,
    purpose: `Execute ${id}`,
    target,
    outputs: [],
    acceptanceCriteria: [],
    riskClass: "READ_ONLY",
    approvalPolicy: "AUTO",
    failurePolicy: "FAIL_PLAN",
    joinPolicy: "ALL_REQUIRED",
    ...overrides,
  };
}

function plan(
  invocations: readonly Invocation[],
  dependencies: ExecutionPlan["dependencies"] = [],
): ExecutionPlan {
  return {
    schemaVersion: 1,
    goal: "Test orchestration contract",
    maxParallelism: 4,
    invocations,
    dependencies,
  };
}

describe("executionPlanSchema", () => {
  it("represents a sequential artifact data-flow without natural-language ordering keywords", () => {
    const value = plan(
      [
        invocation("prompt", { kind: "AI_MODEL", modelSlug: "gpt" }, {
          outputs: [{ name: "prompt", artifactType: "PROMPT" }],
        }),
        invocation("image", { kind: "AI_MODEL", modelSlug: "image-model" }, {
          outputs: [{ name: "image", artifactType: "IMAGE" }],
        }),
      ],
      [
        {
          id: "prompt-to-image",
          fromInvocationId: "prompt",
          toInvocationId: "image",
          condition: { kind: "DATA" },
          inputBindings: [
            {
              inputName: "prompt",
              sourceOutputName: "prompt",
              expectedArtifactType: "PROMPT",
            },
          ],
        },
      ],
    );

    expect(parseExecutionPlan(value)).toEqual(value);
  });

  it("represents independent parallel branches", () => {
    const value = plan([
      invocation("gpt", { kind: "AI_MODEL", modelSlug: "gpt" }),
      invocation("claude", { kind: "AI_MODEL", modelSlug: "claude" }),
    ]);

    expect(parseExecutionPlan(value)).toEqual(value);
  });

  it("represents evaluator outcome branches", () => {
    const value = plan(
      [
        invocation("evaluate", { kind: "EVALUATOR" }, {
          acceptanceCriteria: [
            {
              id: "matches-request",
              description: "Generated image satisfies the frozen acceptance criteria",
              mode: "AI_EVALUATOR",
            },
          ],
        }),
        invocation("notify-group", { kind: "VIMLA" }, { riskClass: "INTERNAL_WRITE" }),
        invocation("notify-nikita", { kind: "VIMLA" }, { riskClass: "INTERNAL_WRITE" }),
      ],
      [
        {
          id: "pass",
          fromInvocationId: "evaluate",
          toInvocationId: "notify-group",
          condition: { kind: "OUTCOME", outcome: "PASS" },
          inputBindings: [],
        },
        {
          id: "fail",
          fromInvocationId: "evaluate",
          toInvocationId: "notify-nikita",
          condition: { kind: "OUTCOME", outcome: "FAIL" },
          inputBindings: [],
        },
      ],
    );

    expect(parseExecutionPlan(value)).toEqual(value);
  });

  it("represents a join across multiple upstream artifacts", () => {
    const value = plan(
      [
        invocation("first", { kind: "AI_MODEL", modelSlug: "gpt" }, {
          outputs: [{ name: "firstText", artifactType: "TEXT" }],
        }),
        invocation("second", { kind: "AI_MODEL", modelSlug: "claude" }, {
          outputs: [{ name: "secondText", artifactType: "TEXT" }],
        }),
        invocation("join", { kind: "VIMLA" }, { joinPolicy: "ALL_REQUIRED" }),
      ],
      [
        {
          id: "first-to-join",
          fromInvocationId: "first",
          toInvocationId: "join",
          condition: { kind: "DATA" },
          inputBindings: [
            {
              inputName: "first",
              sourceOutputName: "firstText",
              expectedArtifactType: "TEXT",
            },
          ],
        },
        {
          id: "second-to-join",
          fromInvocationId: "second",
          toInvocationId: "join",
          condition: { kind: "DATA" },
          inputBindings: [
            {
              inputName: "second",
              sourceOutputName: "secondText",
              expectedArtifactType: "TEXT",
            },
          ],
        },
      ],
    );

    expect(parseExecutionPlan(value)).toEqual(value);
  });

  it("keeps future agents inside the invocation target contract", () => {
    const value = plan([invocation("agent", { kind: "AGENT", agentId: "research-agent" })]);

    expect(parseExecutionPlan(value).invocations[0]?.target).toEqual({
      kind: "AGENT",
      agentId: "research-agent",
    });
  });

  it("rejects provider-specific fields from an AI model target", () => {
    const value = {
      ...plan([invocation("model", { kind: "AI_MODEL", modelSlug: "gpt" })]),
      invocations: [
        {
          ...invocation("model", { kind: "AI_MODEL", modelSlug: "gpt" }),
          target: {
            kind: "AI_MODEL",
            modelSlug: "gpt",
            providerModelId: "must-not-leak",
          },
        },
      ],
    };

    expect(executionPlanSchema.safeParse(value).success).toBe(false);
  });

  it("rejects authoritative price fields from the plan contract", () => {
    const value = {
      ...plan([invocation("model", { kind: "AI_AUTO" })]),
      priceMicroRub: "1000000",
    };

    expect(executionPlanSchema.safeParse(value).success).toBe(false);
  });
});
