import { describe, expect, it } from "vitest";
import {
  LocalInferenceError,
  type AiProvider,
  type ProviderChatRequest,
  type ProviderChatResult,
  type ProviderStreamEvent,
} from "@vimla/ai";
import {
  LocalInferenceVimlaToolPlanner,
  RedisVimlaCoreFairUseLimiter,
  type VimlaCoreFairUseLimiter,
} from "./vimla-core-planner.js";
import { ExternalAiAwareInvocationExecutorRegistry } from "./external-ai-invocation-executor.js";
import {
  VimlaAwareInvocationExecutorRegistry,
} from "./vimla-invocation-executor.js";
import type {
  InvocationExecutionInput,
  InvocationExecutorRegistry,
} from "./orchestration.js";

const input = {
  actorUserId: "user-1",
  correlationId: "corr-1",
  userText: "create a task",
  locale: "en" as const,
  snapshot: {
    locale: "en",
    timezone: "UTC",
    tasks: [],
    reminders: [],
    notes: [],
    lists: [],
  },
  dependencyContext: null,
};

class FakeProvider implements AiProvider {
  readonly id = "fake-local";
  calls = 0;

  constructor(private readonly events: readonly ProviderStreamEvent[]) {}

  async streamChat(_request: ProviderChatRequest): Promise<ProviderChatResult> {
    this.calls += 1;
    const events = this.events;
    return {
      providerRequestId: "local-test",
      events: (async function* () {
        yield* events;
      })(),
    };
  }
}

describe("LocalInferenceVimlaToolPlanner", () => {
  it("parses the existing typed operator PlannerPlan contract", async () => {
    const provider = new FakeProvider([
      {
        type: "delta",
        text: JSON.stringify({
          intent: "act",
          userMessage: "Created",
          clarificationQuestion: null,
          commands: [{ tool: "tasks.create", args: { title: "Task" } }],
        }),
      },
      { type: "done" },
    ]);
    let released = 0;
    const fairUse: VimlaCoreFairUseLimiter = {
      acquire: async () => ({
        release: async () => {
          released += 1;
        },
      }),
    };
    const planner = new LocalInferenceVimlaToolPlanner(
      provider,
      "qwen-local",
      512,
      fairUse,
    );

    await expect(planner.plan(input)).resolves.toMatchObject({
      intent: "act",
      commands: [{ tool: "tasks.create", args: { title: "Task" } }],
    });
    expect(provider.calls).toBe(1);
    expect(released).toBe(1);
  });

  it("fails closed on fair-use denial without calling inference", async () => {
    const provider = new FakeProvider([]);
    const planner = new LocalInferenceVimlaToolPlanner(
      provider,
      "qwen-local",
      512,
      { acquire: async () => null },
    );

    await expect(planner.plan(input)).rejects.toMatchObject({
      code: "VIMLA_CORE_FAIR_USE_LIMIT",
      retryable: false,
    });
    expect(provider.calls).toBe(0);
  });

  it("never converts a local provider failure into an external-AI fallback", async () => {
    const provider: AiProvider = {
      id: "failing-local",
      streamChat: async () => {
        throw new LocalInferenceError("UNAVAILABLE", true);
      },
    };
    const planner = new LocalInferenceVimlaToolPlanner(
      provider,
      "qwen-local",
      512,
      {
        acquire: async () => ({
          release: async () => undefined,
        }),
      },
    );

    await expect(planner.plan(input)).rejects.toMatchObject({
      code: "VIMLA_CORE_UNAVAILABLE",
      retryable: true,
    });
  });

  it("uses Redis-backed per-user rate/concurrency decisions and idempotent release", async () => {
    const calls: Array<{ script: string; keys: number; args: Array<string | number> }> = [];
    const limiter = new RedisVimlaCoreFairUseLimiter(
      async (script, keys, ...args) => {
        calls.push({ script, keys, args });
        return calls.length === 1 ? 1 : 0;
      },
      20,
      2,
      120_000,
    );

    const lease = await limiter.acquire("user-sensitive-id");
    expect(lease).not.toBeNull();
    await lease?.release();
    await lease?.release();

    expect(calls).toHaveLength(2);
    expect(String(calls[0]?.args[0])).not.toContain("user-sensitive-id");
    expect(calls[0]?.keys).toBe(2);
    expect(calls[0]?.script).toContain("ZREMRANGEBYSCORE");
    expect(calls[0]?.script).toContain("ZADD");
    expect(calls[1]?.keys).toBe(1);
    expect(calls[1]?.script).toContain("ZREM");

    const acquiredLeaseId = calls[0]?.args[6];
    expect(typeof acquiredLeaseId).toBe("string");
    expect(acquiredLeaseId).toBe(calls[1]?.args[1]);
  });
});

describe("Vimla Core executor routing", () => {
  it("never routes a VIMLA failure into the paid external executor or generic fallback", async () => {
    let paidCalls = 0;
    let vimlaCalls = 0;
    let fallbackCalls = 0;

    const paid: InvocationExecutorRegistry = {
      execute: async () => {
        paidCalls += 1;
        return { status: "COMPLETED", outcome: "PAID" };
      },
    };
    const vimla: InvocationExecutorRegistry = {
      execute: async () => {
        vimlaCalls += 1;
        return {
          status: "FAILED",
          errorCode: "VIMLA_CORE_UNAVAILABLE",
          retryable: true,
        };
      },
    };
    const fallback: InvocationExecutorRegistry = {
      execute: async () => {
        fallbackCalls += 1;
        return {
          status: "FAILED",
          errorCode: "UNEXPECTED_FALLBACK",
          retryable: false,
        };
      },
    };

    const registry = new ExternalAiAwareInvocationExecutorRegistry(
      paid,
      new VimlaAwareInvocationExecutorRegistry(vimla, fallback),
    );
    const execution: InvocationExecutionInput = {
      planId: "plan-1",
      invocationId: "invocation-1",
      attempt: 1,
      runId: "run-1",
      idempotencyKey: "run-1:1",
      target: {
        kind: "VIMLA",
        modelSlug: null,
        agentId: null,
      },
    };

    await expect(registry.execute(execution)).resolves.toEqual({
      status: "FAILED",
      errorCode: "VIMLA_CORE_UNAVAILABLE",
      retryable: true,
    });
    expect(vimlaCalls).toBe(1);
    expect(paidCalls).toBe(0);
    expect(fallbackCalls).toBe(0);
  });
});
