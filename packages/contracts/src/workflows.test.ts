import { describe, expect, it } from "vitest";
import {
  executionPlanConversationViewSchema,
  executionPlanViewSchema,
} from "./workflows.js";

function planFixture() {
  return {
    id: "plan-1",
    messageId: "message-1",
    conversationId: "conversation-1",
    schemaVersion: 1 as const,
    version: 1,
    planHash: "sha256:test",
    goal: "Create a reminder",
    status: "RUNNING" as const,
    maxParallelism: 1,
    invocations: [
      {
        id: "remind",
        purpose: "Create the reminder",
        target: { kind: "VIMLA" as const },
        outputs: [],
        acceptanceCriteria: [],
        riskClass: "INTERNAL_WRITE" as const,
        approvalPolicy: "USER_CONFIRMATION" as const,
        failurePolicy: "FAIL_PLAN" as const,
        joinPolicy: "ALL_REQUIRED" as const,
        status: "WAITING_APPROVAL" as const,
        requiresApproval: true,
        latestRun: {
          id: "run-1",
          attempt: 1,
          status: "RUNNING" as const,
          outcome: null,
          errorCode: null,
          startedAt: "2026-09-21T08:00:00.000Z",
          finishedAt: null,
          evaluation: null,
        },
        artifacts: [
          {
            artifactId: "artifact-1",
            artifactVersionId: "artifact-version-1",
            outputName: "result",
            type: "TEXT" as const,
            classification: "PRIVATE",
            version: 1,
            createdAt: "2026-09-21T08:00:01.000Z",
            contentJson: { secret: true },
            contentRef: "secret://payload",
            metadata: { hidden: true },
          },
        ],
      },
    ],
    dependencies: [],
    startedAt: "2026-09-21T08:00:00.000Z",
    frozenAt: "2026-09-21T08:00:00.000Z",
    completedAt: null,
    createdAt: "2026-09-21T07:59:59.000Z",
    updatedAt: "2026-09-21T08:00:01.000Z",
  };
}

describe("workflow UI contracts", () => {
  it("rejects artifact internals that are not part of the public read model", () => {
    expect(() => executionPlanViewSchema.parse(planFixture())).toThrow();
  });

  it("parses the exact public workflow read model", () => {
    const fixture = planFixture();
    fixture.invocations[0] = {
      ...fixture.invocations[0],
      artifacts: [
        {
          artifactId: "artifact-1",
          artifactVersionId: "artifact-version-1",
          outputName: "result",
          type: "TEXT",
          classification: "PRIVATE",
          version: 1,
          createdAt: "2026-09-21T08:00:01.000Z",
        },
      ],
    };
    const parsed = executionPlanViewSchema.parse(fixture);
    expect(parsed.invocations[0]?.artifacts[0]).toEqual(
      fixture.invocations[0].artifacts[0],
    );
    expect(parsed.invocations[0]?.latestRun?.evaluation).toBeNull();
  });

  it("parses a conversation workflow collection", () => {
    const fixture = planFixture();
    fixture.invocations[0] = {
      ...fixture.invocations[0],
      artifacts: [],
    };
    const parsed = executionPlanConversationViewSchema.parse({
      plans: [fixture],
    });
    expect(parsed.plans).toHaveLength(1);
    expect(parsed.plans[0]?.invocations[0]?.requiresApproval).toBe(true);
  });

  it("rejects an unknown durable invocation status", () => {
    const fixture = planFixture();
    fixture.invocations[0] = {
      ...fixture.invocations[0],
      artifacts: [],
      status: "MYSTERY" as never,
    };
    expect(() => executionPlanViewSchema.parse(fixture)).toThrow();
  });
});
