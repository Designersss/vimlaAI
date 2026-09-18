import assert from "node:assert/strict";
import test from "node:test";
import {
  invocationTargetForPlannerMention,
  parseExecutionPlan,
  toPlannerInvocationMentions,
  withPlannerMentionRole,
} from "../dist/index.js";

function mention(overrides = {}) {
  return {
    id: "mention-1",
    handleId: "handle-auto",
    kind: "AI_AUTO",
    targetId: "AI_AUTO",
    canonicalHandle: "auto",
    startOffset: 0,
    endOffset: 5,
    ...overrides,
  };
}

function invocation(id, target, overrides = {}) {
  return {
    id,
    purpose: id,
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

test("multiple Auto occurrences can become distinct artifact-linked invocation nodes", () => {
  const mentions = toPlannerInvocationMentions([
    mention({ id: "auto-prompt", startOffset: 0, endOffset: 5 }),
    mention({ id: "auto-generate", startOffset: 30, endOffset: 35 }),
    mention({ id: "auto-review", startOffset: 60, endOffset: 65 }),
  ]);

  const plan = parseExecutionPlan({
    schemaVersion: 1,
    goal: "Generate a prompt, produce a result, then review it",
    maxParallelism: 2,
    invocations: [
      invocation(
        "prompt",
        invocationTargetForPlannerMention(mentions[0]),
        { outputs: [{ name: "prompt", artifactType: "PROMPT" }] },
      ),
      invocation(
        "generate",
        invocationTargetForPlannerMention(mentions[1]),
        { outputs: [{ name: "result", artifactType: "TEXT" }] },
      ),
      invocation(
        "review",
        invocationTargetForPlannerMention(mentions[2]),
        {
          acceptanceCriteria: [
            {
              id: "quality",
              description: "Result satisfies the requested quality bar",
              mode: "AI_EVALUATOR",
            },
          ],
        },
      ),
    ],
    dependencies: [
      {
        id: "prompt-to-generate",
        fromInvocationId: "prompt",
        toInvocationId: "generate",
        condition: { kind: "DATA" },
        inputBindings: [
          {
            inputName: "prompt",
            sourceOutputName: "prompt",
            expectedArtifactType: "PROMPT",
          },
        ],
      },
      {
        id: "generate-to-review",
        fromInvocationId: "generate",
        toInvocationId: "review",
        condition: { kind: "DATA" },
        inputBindings: [
          {
            inputName: "result",
            sourceOutputName: "result",
            expectedArtifactType: "TEXT",
          },
        ],
      },
    ],
  });

  assert.deepEqual(
    plan.invocations.map((item) => item.target),
    [{ kind: "AI_AUTO" }, { kind: "AI_AUTO" }, { kind: "AI_AUTO" }],
  );
  assert.equal(plan.dependencies.length, 2);
});

test("Auto evaluator can feed a PASS branch into Vimla without becoming a special mention syntax", () => {
  const mentions = toPlannerInvocationMentions([
    mention({ id: "auto-evaluator", startOffset: 0, endOffset: 5 }),
    mention({
      id: "vimla-action",
      handleId: "handle-vimla",
      kind: "SYSTEM_AGENT",
      targetId: "VIMLA",
      canonicalHandle: "vimla",
      startOffset: 40,
      endOffset: 46,
    }),
  ]);

  const evaluatorMention = withPlannerMentionRole(mentions[0], "EVALUATION");
  const plan = parseExecutionPlan({
    schemaVersion: 1,
    goal: "Review the result and create a task when approved",
    maxParallelism: 1,
    invocations: [
      invocation(
        "evaluate",
        invocationTargetForPlannerMention(evaluatorMention),
        {
          acceptanceCriteria: [
            {
              id: "approved",
              description: "Result is approved",
              mode: "AI_EVALUATOR",
            },
          ],
        },
      ),
      invocation(
        "create-task",
        invocationTargetForPlannerMention(mentions[1]),
        { riskClass: "INTERNAL_WRITE" },
      ),
    ],
    dependencies: [
      {
        id: "approved-to-task",
        fromInvocationId: "evaluate",
        toInvocationId: "create-task",
        condition: { kind: "OUTCOME", outcome: "PASS" },
        inputBindings: [],
      },
    ],
  });

  assert.equal(evaluatorMention.semanticRole, "EVALUATION");
  assert.deepEqual(plan.invocations[0].target, { kind: "AI_AUTO" });
  assert.deepEqual(plan.invocations[1].target, { kind: "VIMLA" });
  assert.deepEqual(plan.dependencies[0].condition, {
    kind: "OUTCOME",
    outcome: "PASS",
  });
});
