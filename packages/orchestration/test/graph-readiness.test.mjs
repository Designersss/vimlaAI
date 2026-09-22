import assert from "node:assert/strict";
import test from "node:test";
import {
  GraphValidationError,
  computePendingInvocationTransitions,
  decideInvocationReadiness,
  validateExecutionPlanGraph,
} from "../dist/index.js";

function invocation(id, overrides = {}) {
  return {
    id,
    purpose: `Execute ${id}`,
    target: { kind: "VIMLA" },
    outputs: [],
    acceptanceCriteria: [],
    riskClass: "READ_ONLY",
    approvalPolicy: "AUTO",
    failurePolicy: "FAIL_PLAN",
    joinPolicy: "ALL_REQUIRED",
    ...overrides,
  };
}

function dep(id, fromInvocationId, toInvocationId, condition = { kind: "ON_SUCCESS" }, inputBindings = []) {
  return { id, fromInvocationId, toInvocationId, condition, inputBindings };
}

function plan(invocations, dependencies = []) {
  return {
    schemaVersion: 1,
    goal: "Graph validation test",
    maxParallelism: 8,
    invocations,
    dependencies,
  };
}

function expectGraphError(value, code) {
  assert.throws(
    () => validateExecutionPlanGraph(value),
    (error) => error instanceof GraphValidationError && error.code === code,
  );
}

test("normalizes sequential and parallel DAGs deterministically", () => {
  const value = plan(
    [invocation("a"), invocation("b"), invocation("c"), invocation("join", { joinPolicy: "ALL_REQUIRED" })],
    [
      dep("ab", "a", "b"),
      dep("ac", "a", "c"),
      dep("bj", "b", "join"),
      dep("cj", "c", "join"),
    ],
  );
  const graph = validateExecutionPlanGraph(value);
  assert.equal(graph.topologicalOrder[0], "a");
  assert.equal(graph.depthByInvocationId.get("join"), 2);
  assert.equal(graph.outgoingByInvocationId.get("a").length, 2);
});

test("rejects cycles and unknown dependency endpoints", () => {
  expectGraphError(plan([invocation("a"), invocation("b")], [dep("ab", "a", "b"), dep("ba", "b", "a")]), "CYCLE");
  expectGraphError(plan([invocation("a")], [dep("bad", "a", "missing")]), "UNKNOWN_TARGET");
});

test("validates DATA bindings and artifact compatibility", () => {
  const producer = invocation("producer", { outputs: [{ name: "prompt", artifactType: "PROMPT" }] });
  const consumer = invocation("consumer");

  validateExecutionPlanGraph(
    plan([producer, consumer], [
      dep("data", "producer", "consumer", { kind: "DATA" }, [
        { inputName: "prompt", sourceOutputName: "prompt", expectedArtifactType: "PROMPT" },
      ]),
    ]),
  );

  expectGraphError(
    plan([producer, consumer], [
      dep("missing", "producer", "consumer", { kind: "DATA" }, [
        { inputName: "prompt", sourceOutputName: "missing", expectedArtifactType: "PROMPT" },
      ]),
    ]),
    "MISSING_SOURCE_OUTPUT",
  );

  expectGraphError(
    plan([producer, consumer], [
      dep("wrong-type", "producer", "consumer", { kind: "DATA" }, [
        { inputName: "prompt", sourceOutputName: "prompt", expectedArtifactType: "IMAGE" },
      ]),
    ]),
    "ARTIFACT_TYPE_MISMATCH",
  );
});

test("rejects duplicate inputs, invalid joins and graph limits", () => {
  const a = invocation("a", { outputs: [{ name: "x", artifactType: "TEXT" }] });
  const b = invocation("b", { outputs: [{ name: "y", artifactType: "TEXT" }] });
  const target = invocation("target");
  expectGraphError(
    plan([a, b, target], [
      dep("a-t", "a", "target", { kind: "DATA" }, [{ inputName: "same", sourceOutputName: "x", expectedArtifactType: "TEXT" }]),
      dep("b-t", "b", "target", { kind: "DATA" }, [{ inputName: "same", sourceOutputName: "y", expectedArtifactType: "TEXT" }]),
    ]),
    "DUPLICATE_INPUT",
  );

  expectGraphError(plan([invocation("root", { joinPolicy: "ANY_REQUIRED" })]), "INVALID_JOIN");

  assert.throws(
    () => validateExecutionPlanGraph(plan([invocation("a"), invocation("b")]), { maxInvocations: 1, maxDependencies: 10, maxDepth: 10, maxFanOut: 10 }),
    (error) => error instanceof GraphValidationError && error.code === "GRAPH_LIMIT_EXCEEDED",
  );
});

test("rejects duplicate evaluator acceptance criterion ids", () => {
  const source = invocation("source", {
    outputs: [{ name: "result", artifactType: "TEXT" }],
  });
  const evaluator = invocation("evaluate", {
    target: { kind: "EVALUATOR" },
    outputs: [{ name: "evaluation", artifactType: "JSON" }],
    acceptanceCriteria: [
      {
        id: "quality",
        description: "First quality criterion",
        mode: "DETERMINISTIC",
        binding: {
          kind: "ARTIFACT_EXISTS",
          inputName: "result",
        },
      },
      {
        id: "quality",
        description: "Duplicate quality criterion",
        mode: "DETERMINISTIC",
        binding: {
          kind: "ARTIFACT_EXISTS",
          inputName: "result",
        },
      },
    ],
  });
  expectGraphError(
    plan(
      [source, evaluator],
      [
        dep("data", "source", "evaluate", { kind: "DATA" }, [
          {
            inputName: "result",
            sourceOutputName: "result",
            expectedArtifactType: "TEXT",
          },
        ]),
      ],
    ),
    "INVALID_EVALUATOR",
  );
});

test("rejects invalid deterministic JSON pointer bindings before execution", () => {
  const source = invocation("source", {
    outputs: [{ name: "result", artifactType: "JSON" }],
  });
  const evaluator = invocation("evaluate", {
    target: { kind: "EVALUATOR" },
    outputs: [{ name: "evaluation", artifactType: "JSON" }],
    acceptanceCriteria: [
      {
        id: "json-check",
        description: "Check structured result",
        mode: "DETERMINISTIC",
        binding: {
          kind: "JSON_EQUALS",
          inputName: "result",
          path: "missing-leading-slash",
          expectedValue: true,
        },
      },
    ],
  });
  expectGraphError(
    plan(
      [source, evaluator],
      [
        dep("data", "source", "evaluate", { kind: "DATA" }, [
          {
            inputName: "result",
            sourceOutputName: "result",
            expectedArtifactType: "JSON",
          },
        ]),
      ],
    ),
    "INVALID_EVALUATOR_BINDING",
  );
});

test("enforces evaluator approval policy and read-only risk", () => {
  const human = invocation("human-evaluator", {
    target: { kind: "EVALUATOR" },
    outputs: [{ name: "evaluation", artifactType: "JSON" }],
    acceptanceCriteria: [
      {
        id: "human-review",
        description: "Human accepts the result",
        mode: "HUMAN_APPROVAL",
      },
    ],
    approvalPolicy: "AUTO",
  });
  expectGraphError(plan([human]), "INVALID_EVALUATOR");

  const automated = invocation("automatic-evaluator", {
    target: { kind: "EVALUATOR" },
    outputs: [{ name: "evaluation", artifactType: "JSON" }],
    acceptanceCriteria: [
      {
        id: "quality",
        description: "AI checks quality",
        mode: "AI_EVALUATOR",
      },
    ],
    approvalPolicy: "HUMAN_APPROVAL",
  });
  expectGraphError(plan([automated]), "INVALID_EVALUATOR");

  const risky = invocation("risky-evaluator", {
    target: { kind: "EVALUATOR" },
    outputs: [{ name: "evaluation", artifactType: "JSON" }],
    acceptanceCriteria: [
      {
        id: "quality",
        description: "AI checks quality",
        mode: "AI_EVALUATOR",
      },
    ],
    riskClass: "INTERNAL_WRITE",
  });
  expectGraphError(plan([risky]), "INVALID_EVALUATOR");
});

test("readiness handles roots, success, failure and outcome branches", () => {
  const root = invocation("root");
  assert.equal(decideInvocationReadiness(root, [], new Map()).decision, "READY");

  const successTarget = invocation("success");
  const failureTarget = invocation("failure");
  const passTarget = invocation("pass");
  const states = new Map([
    ["source", { invocationId: "source", status: "COMPLETED", outcome: "PASS" }],
  ]);

  assert.equal(decideInvocationReadiness(successTarget, [dep("s", "source", "success", { kind: "ON_SUCCESS" })], states).decision, "READY");
  assert.equal(decideInvocationReadiness(failureTarget, [dep("f", "source", "failure", { kind: "ON_FAILURE" })], states).decision, "SKIPPED");
  assert.equal(decideInvocationReadiness(passTarget, [dep("p", "source", "pass", { kind: "OUTCOME", outcome: "PASS" })], states).decision, "READY");
});

test("readiness supports ANY_REQUIRED and ALL_SETTLED joins", () => {
  const any = invocation("any", { joinPolicy: "ANY_REQUIRED" });
  const settled = invocation("settled", { joinPolicy: "ALL_SETTLED" });
  const incomingAny = [dep("a", "a", "any"), dep("b", "b", "any")];
  const incomingSettled = [dep("c", "a", "settled"), dep("d", "b", "settled")];

  const partial = new Map([
    ["a", { invocationId: "a", status: "FAILED" }],
    ["b", { invocationId: "b", status: "RUNNING" }],
  ]);
  assert.equal(decideInvocationReadiness(any, incomingAny, partial).decision, "PENDING");
  assert.equal(decideInvocationReadiness(settled, incomingSettled, partial).decision, "PENDING");

  const terminal = new Map([
    ["a", { invocationId: "a", status: "FAILED" }],
    ["b", { invocationId: "b", status: "COMPLETED" }],
  ]);
  assert.equal(decideInvocationReadiness(any, incomingAny, terminal).decision, "READY");
  assert.equal(decideInvocationReadiness(settled, incomingSettled, terminal).decision, "READY");
});

test("computes only pending invocation transitions", () => {
  const invocations = [invocation("root"), invocation("child")];
  const dependencies = [dep("edge", "root", "child")];
  const runtime = new Map([
    ["root", { invocationId: "root", status: "COMPLETED" }],
    ["child", { invocationId: "child", status: "PENDING" }],
  ]);
  const result = computePendingInvocationTransitions(invocations, dependencies, runtime);
  assert.equal(result.has("root"), false);
  assert.equal(result.get("child").decision, "READY");
});
