import assert from "node:assert/strict";
import test from "node:test";
import { executionPlanSchema, parseExecutionPlan } from "../dist/index.js";

function invocation(id, target, overrides = {}) {
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

function plan(invocations, dependencies = []) {
  return {
    schemaVersion: 1,
    goal: "Test orchestration contract",
    maxParallelism: 4,
    invocations,
    dependencies,
  };
}

test("represents sequential artifact data-flow without ordering keywords", () => {
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

  assert.deepEqual(parseExecutionPlan(value), value);
});

test("represents independent parallel branches", () => {
  const value = plan([
    invocation("gpt", { kind: "AI_MODEL", modelSlug: "gpt" }),
    invocation("claude", { kind: "AI_MODEL", modelSlug: "claude" }),
  ]);

  assert.deepEqual(parseExecutionPlan(value), value);
});

test("represents success, failure, always and evaluator outcome branches", () => {
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
      invocation("on-pass", { kind: "VIMLA" }, { riskClass: "INTERNAL_WRITE" }),
      invocation("on-fail", { kind: "VIMLA" }, { riskClass: "INTERNAL_WRITE" }),
      invocation("on-success", { kind: "VIMLA" }),
      invocation("on-failure", { kind: "VIMLA" }),
      invocation("always", { kind: "VIMLA" }),
    ],
    [
      {
        id: "pass",
        fromInvocationId: "evaluate",
        toInvocationId: "on-pass",
        condition: { kind: "OUTCOME", outcome: "PASS" },
        inputBindings: [],
      },
      {
        id: "fail",
        fromInvocationId: "evaluate",
        toInvocationId: "on-fail",
        condition: { kind: "OUTCOME", outcome: "FAIL" },
        inputBindings: [],
      },
      {
        id: "success",
        fromInvocationId: "evaluate",
        toInvocationId: "on-success",
        condition: { kind: "ON_SUCCESS" },
        inputBindings: [],
      },
      {
        id: "failure",
        fromInvocationId: "evaluate",
        toInvocationId: "on-failure",
        condition: { kind: "ON_FAILURE" },
        inputBindings: [],
      },
      {
        id: "always",
        fromInvocationId: "evaluate",
        toInvocationId: "always",
        condition: { kind: "ALWAYS" },
        inputBindings: [],
      },
    ],
  );

  assert.deepEqual(parseExecutionPlan(value), value);
});

test("represents a join across multiple upstream artifacts", () => {
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
          { inputName: "first", sourceOutputName: "firstText", expectedArtifactType: "TEXT" },
        ],
      },
      {
        id: "second-to-join",
        fromInvocationId: "second",
        toInvocationId: "join",
        condition: { kind: "DATA" },
        inputBindings: [
          { inputName: "second", sourceOutputName: "secondText", expectedArtifactType: "TEXT" },
        ],
      },
    ],
  );

  assert.deepEqual(parseExecutionPlan(value), value);
});

test("keeps future agents inside the invocation target contract", () => {
  const value = plan([invocation("agent", { kind: "AGENT", agentId: "research-agent" })]);
  assert.deepEqual(parseExecutionPlan(value).invocations[0]?.target, {
    kind: "AGENT",
    agentId: "research-agent",
  });
});

test("rejects provider-specific fields from AI model targets", () => {
  const value = {
    ...plan([invocation("model", { kind: "AI_MODEL", modelSlug: "gpt" })]),
    invocations: [
      {
        ...invocation("model", { kind: "AI_MODEL", modelSlug: "gpt" }),
        target: { kind: "AI_MODEL", modelSlug: "gpt", providerModelId: "must-not-leak" },
      },
    ],
  };

  assert.equal(executionPlanSchema.safeParse(value).success, false);
});

test("rejects authoritative price fields from the plan contract", () => {
  const value = {
    ...plan([invocation("model", { kind: "AI_AUTO" })]),
    priceMicroRub: "1000000",
  };

  assert.equal(executionPlanSchema.safeParse(value).success, false);
});
