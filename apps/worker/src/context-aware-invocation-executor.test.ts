import { describe, expect, it, vi } from "vitest";
import {
  ContextAccessDeniedError,
  ContextValidationError,
  type ContextBundleService,
  type ContextBundleView,
} from "@vimla/context";
import type { PrismaClient } from "@vimla/database";
import type { TelemetryEvent, TelemetrySink } from "@vimla/shared";
import { ContextAwareInvocationExecutorRegistry } from "./context-aware-invocation-executor.js";
import type {
  InvocationExecutionInput,
  InvocationExecutorRegistry,
} from "./orchestration.js";

const persistedVimlaInvocation = {
  targetKind: "VIMLA",
  targetModelSlug: null,
  targetAgentId: null,
  plan: { userId: "user-1" },
};

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

function recordingTelemetry(): {
  events: TelemetryEvent[];
  sink: TelemetrySink;
} {
  const events: TelemetryEvent[] = [];
  return {
    events,
    sink: {
      emit: (event) => {
        events.push(event);
      },
    },
  };
}

function contextBundle(
  surfaceKind: ContextBundleView["manifest"]["surfaceKind"],
): ContextBundleView {
  return {
    id: "bundle-1",
    invocationId: input.invocationId,
    snapshotId: "snapshot-1",
    fingerprint: `sha256:${surfaceKind.toLowerCase()}`,
    manifest: {
      version: 1,
      packingVersion: 1,
      targetKind: "VIMLA",
      surfaceKind,
      surfaceScopeHash: "sha256:surface",
      audienceParticipantCount: 1,
      budget: {
        contextWindowTokens: 32_768,
        outputReserveTokens: 4_096,
        systemToolReserveTokens: 2_048,
        artifactReserveTokens: 4_096,
        safetyMarginTokens: 2_621,
        effectiveHistoryBudgetTokens: 19_907,
        compactedStateTriggerTokens: 15_925,
      },
      usedTokens: 64,
      rawHistoryTokens: 512,
      compactedStateRequired: false,
      allowedItems: [
        {
          snapshotItemId: "item-l1",
          sourceType: "MESSAGE",
          classification: "PRIVATE",
          fingerprint: "sha256:item-l1",
          estimatedTokens: 64,
          selectionReason: "CURRENT_SURFACE",
        },
      ],
      allowedArtifacts: [],
      denials: [],
      packingExclusions: [],
      artifactDenials: [],
    },
    items: [
      {
        id: "item-l1",
        sequence: 0,
        sourceType: "MESSAGE",
        sourceId: "message-l1",
        sourceVersion: "1",
        classification: "PRIVATE",
        contentRef: "vimla://messages/message-l1",
        metadata: {
          retrieval: {
            sourceKind: "L1_RAW",
          },
        },
        fingerprint: "sha256:item-l1",
        createdAt: "2026-09-25T00:00:00.000Z",
      },
    ],
    artifacts: [],
    createdAt: "2026-09-25T00:00:00.000Z",
  };
}

describe("ContextAwareInvocationExecutorRegistry", () => {
  it("fails closed before DB or fallback access when context retrieval is disabled", async () => {
    const findFirst = vi.fn();
    const execute = vi.fn();
    const resolveForInvocation = vi.fn();
    const registry = new ContextAwareInvocationExecutorRegistry(
      {
        invocation: { findFirst },
      } as unknown as PrismaClient,
      { execute } satisfies InvocationExecutorRegistry,
      { resolveForInvocation } as unknown as ContextBundleService,
      false,
    );

    await expect(registry.execute(input)).resolves.toEqual({
      status: "FAILED",
      errorCode: "CONTEXT_RETRIEVAL_DISABLED",
      retryable: false,
    });
    expect(findFirst).not.toHaveBeenCalled();
    expect(resolveForInvocation).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("delegates only after the invocation context passes authorization", async () => {
    const findFirst = vi.fn().mockResolvedValue(persistedVimlaInvocation);
    const allowedBundle = contextBundle("PERSONAL");
    const resolveForInvocation = vi.fn().mockResolvedValue(allowedBundle);
    const execute = vi.fn().mockResolvedValue({
      status: "COMPLETED" as const,
    });
    const telemetry = recordingTelemetry();

    const registry = new ContextAwareInvocationExecutorRegistry(
      {
        invocation: { findFirst },
      } as unknown as PrismaClient,
      { execute } satisfies InvocationExecutorRegistry,
      { resolveForInvocation } as unknown as ContextBundleService,
      true,
      telemetry.sink,
    );

    await expect(registry.execute(input)).resolves.toEqual({
      status: "COMPLETED",
    });
    expect(resolveForInvocation).toHaveBeenCalledWith({
      actorUserId: "user-1",
      invocationId: "invocation-1",
    });
    expect(execute).toHaveBeenCalledWith({
      ...input,
      contextBundle: allowedBundle,
    });
    expect(telemetry.events).toContainEqual(
      expect.objectContaining({
        event: "context.bundle",
        planId: input.planId,
        invocationId: input.invocationId,
        outcome: "SUCCESS",
        selectedItemCount: 1,
        deniedItemCount: 0,
        rawHistoryTokens: 512,
        l1RawTokens: 64,
        l2CompactedTokens: 0,
      }),
    );
  });

  it("fails closed and never delegates when audience authorization is denied", async () => {
    const execute = vi.fn();
    const telemetry = recordingTelemetry();
    const registry = new ContextAwareInvocationExecutorRegistry(
      {
        invocation: {
          findFirst: vi.fn().mockResolvedValue(persistedVimlaInvocation),
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
      true,
      telemetry.sink,
    );

    await expect(registry.execute(input)).resolves.toEqual({
      status: "FAILED",
      errorCode: "CONTEXT_POLICY_DENIED",
      retryable: false,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(telemetry.events).toContainEqual({
      event: "safety.policy",
      planId: input.planId,
      invocationId: input.invocationId,
      action: "PERMISSION_DENIED",
      reason: "OTHER",
      count: 1,
    });
  });

  it("rejects a queue target that does not match the persisted invocation", async () => {
    const execute = vi.fn();
    const resolveForInvocation = vi.fn();
    const registry = new ContextAwareInvocationExecutorRegistry(
      {
        invocation: {
          findFirst: vi.fn().mockResolvedValue(persistedVimlaInvocation),
        },
      } as unknown as PrismaClient,
      { execute } satisfies InvocationExecutorRegistry,
      { resolveForInvocation } as unknown as ContextBundleService,
    );

    await expect(
      registry.execute({
        ...input,
        target: {
          kind: "AI_MODEL",
          modelSlug: "gpt-5-6-luna",
          agentId: null,
        },
      }),
    ).resolves.toEqual({
      status: "FAILED",
      errorCode: "CONTEXT_POLICY_TARGET_MISMATCH",
      retryable: false,
    });
    expect(resolveForInvocation).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not let the personal Vimla executor run on a shared surface", async () => {
    const execute = vi.fn();
    const registry = new ContextAwareInvocationExecutorRegistry(
      {
        invocation: {
          findFirst: vi.fn().mockResolvedValue(persistedVimlaInvocation),
        },
      } as unknown as PrismaClient,
      { execute } satisfies InvocationExecutorRegistry,
      {
        resolveForInvocation: vi
          .fn()
          .mockResolvedValue(contextBundle("DIRECT_CHAT")),
      } as unknown as ContextBundleService,
    );

    await expect(registry.execute(input)).resolves.toEqual({
      status: "FAILED",
      errorCode: "CONTEXT_POLICY_EXECUTOR_SURFACE_UNSUPPORTED",
      retryable: false,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed on malformed policy context", async () => {
    const execute = vi.fn();
    const registry = new ContextAwareInvocationExecutorRegistry(
      {
        invocation: {
          findFirst: vi.fn().mockResolvedValue(persistedVimlaInvocation),
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
