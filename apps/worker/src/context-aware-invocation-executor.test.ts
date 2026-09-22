import { describe, expect, it, vi } from "vitest";
import {
  ContextAccessDeniedError,
  ContextValidationError,
  type ContextBundleService,
} from "@vimla/context";
import type { PrismaClient } from "@vimla/database";
import { ContextAwareInvocationExecutorRegistry } from "./context-aware-invocation-executor.js";
import type {
  InvocationExecutionInput,
  InvocationExecutorRegistry,
} from "./orchestration.js";

const input: InvocationExecutionInput = {
  planId: "plan-1",
  invocationId: "invocation-1",
  attempt: 1,
  runId: "run-1",
  idempotencyKey: "invocation-1:1",
  target: {
    kind: "VIMLA",
    modelSlug: null,
    agentId: null,
  },
};

describe("ContextAwareInvocationExecutorRegistry", () => {
  it("delegates only after the invocation context passes authorization", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      plan: { userId: "user-1" },
    });
    const resolveForInvocation = vi.fn().mockResolvedValue({
      fingerprint: "sha256:allowed",
    });
    const execute = vi.fn().mockResolvedValue({
      status: "COMPLETED" as const,
    });

    const registry = new ContextAwareInvocationExecutorRegistry(
      {
        invocation: { findFirst },
      } as unknown as PrismaClient,
      { execute } satisfies InvocationExecutorRegistry,
      { resolveForInvocation } as unknown as ContextBundleService,
    );

    await expect(registry.execute(input)).resolves.toEqual({
      status: "COMPLETED",
    });
    expect(resolveForInvocation).toHaveBeenCalledWith({
      actorUserId: "user-1",
      invocationId: "invocation-1",
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("fails closed and never delegates when audience authorization is denied", async () => {
    const execute = vi.fn();
    const registry = new ContextAwareInvocationExecutorRegistry(
      {
        invocation: {
          findFirst: vi.fn().mockResolvedValue({
            plan: { userId: "user-1" },
          }),
        },
      } as unknown as PrismaClient,
      { execute } satisfies InvocationExecutorRegistry,
      {
        resolveForInvocation: vi
          .fn()
          .mockRejectedValue(
            new ContextAccessDeniedError("audience access revoked"),
          ),
      } as unknown as ContextBundleService,
    );

    await expect(registry.execute(input)).resolves.toEqual({
      status: "FAILED",
      errorCode: "CONTEXT_POLICY_DENIED",
      retryable: false,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed on malformed policy context", async () => {
    const execute = vi.fn();
    const registry = new ContextAwareInvocationExecutorRegistry(
      {
        invocation: {
          findFirst: vi.fn().mockResolvedValue({
            plan: { userId: "user-1" },
          }),
        },
      } as unknown as PrismaClient,
      { execute } satisfies InvocationExecutorRegistry,
      {
        resolveForInvocation: vi
          .fn()
          .mockRejectedValue(
            new ContextValidationError("invalid audience descriptor"),
          ),
      } as unknown as ContextBundleService,
    );

    await expect(registry.execute(input)).resolves.toEqual({
      status: "FAILED",
      errorCode: "CONTEXT_POLICY_INVALID",
      retryable: false,
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
