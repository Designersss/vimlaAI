import { describe, expect, it, vi } from "vitest";
import type { TelemetryEvent } from "@vimla/shared";
import {
  createWorkerTelemetrySink,
  toTelemetryLogFields,
} from "./telemetry.js";
import type { RuntimeLogger } from "./orchestration.js";

describe("worker telemetry adapter", () => {
  it("keeps scalar telemetry fields and serializes nested distributions", () => {
    const event: TelemetryEvent = {
      event: "context.snapshot",
      planId: "plan-1",
      outcome: "SUCCESS",
      durationMs: 12,
      itemCount: 3,
      metadataBytes: 128,
      sourceDistribution: {
        MESSAGE: 2,
        PROJECT: 1,
      },
    };

    expect(toTelemetryLogFields(event)).toEqual({
      event: "context.snapshot",
      planId: "plan-1",
      outcome: "SUCCESS",
      durationMs: 12,
      itemCount: 3,
      metadataBytes: 128,
      sourceDistribution: JSON.stringify({
        MESSAGE: 2,
        PROJECT: 1,
      }),
    });
  });

  it("passes only runtime-logger-safe fields to the logger", () => {
    const info = vi.fn();
    const logger: RuntimeLogger = {
      info,
      warn: vi.fn(),
      error: vi.fn(),
    };
    const sink = createWorkerTelemetrySink(logger);

    sink.emit({
      event: "context.bundle",
      planId: "plan-1",
      invocationId: "inv-1",
      targetKind: "VIMLA",
      outcome: "SUCCESS",
      durationMs: 20,
      candidateCountBeforePolicy: 4,
      candidateCountAfterPolicy: 3,
      selectedItemCount: 2,
      deniedItemCount: 1,
      packingExcludedCount: 1,
      artifactDeniedCount: 0,
      budgetTokens: 4096,
      usedTokens: 1024,
      budgetUtilizationBps: 2500,
      rawHistoryTokens: 800,
      l1RawTokens: 800,
      l2CompactedTokens: 224,
      sourceDistribution: { MESSAGE: 1, COMPACTED_STATE: 1 },
      selectionDistribution: { RECENT: 1, RELEVANT: 1 },
      denialDistribution: { ACTOR_ACCESS_DENIED: 1 },
    });

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "context.bundle",
        sourceDistribution: JSON.stringify({
          MESSAGE: 1,
          COMPACTED_STATE: 1,
        }),
        selectionDistribution: JSON.stringify({
          RECENT: 1,
          RELEVANT: 1,
        }),
        denialDistribution: JSON.stringify({
          ACTOR_ACCESS_DENIED: 1,
        }),
      }),
      "telemetry",
    );
  });

  it("drops a malformed client-controlled correlation id", () => {
    const fields = toTelemetryLogFields({
      event: "planner.completed",
      correlationId: "Bearer secret should never be telemetry",
      planId: "plan-1",
      outcome: "SUCCESS",
      durationMs: 10,
      nodeCount: 1,
      edgeCount: 0,
      depth: 1,
      maxParallelism: 1,
      replayed: false,
    });

    expect(fields).toMatchObject({
      event: "planner.completed",
      planId: "plan-1",
      outcome: "SUCCESS",
    });
    expect(fields).not.toHaveProperty("correlationId");
  });

  it("drops unexpected sensitive fields at the runtime telemetry boundary", () => {
    const event = {
      event: "runtime.invocation",
      planId: "plan-1",
      invocationId: "inv-1",
      runId: "run-1",
      targetKind: "VIMLA",
      outcome: "SUCCESS",
      durationMs: 12,
      queueDelayMs: 3,
      attempt: 1,
      retryable: false,
      prompt: "never log this prompt",
      secret: "never log this secret",
      authorization: "Bearer never-log",
    } as TelemetryEvent;

    const fields = toTelemetryLogFields(event);

    expect(fields).toMatchObject({
      event: "runtime.invocation",
      planId: "plan-1",
      invocationId: "inv-1",
    });
    expect(fields).not.toHaveProperty("prompt");
    expect(fields).not.toHaveProperty("secret");
    expect(fields).not.toHaveProperty("authorization");
  });
});
