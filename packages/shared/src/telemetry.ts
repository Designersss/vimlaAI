export type TelemetryOutcome =
  | "SUCCESS"
  | "FAILED"
  | "DENIED"
  | "SKIPPED"
  | "REPLAYED"
  | "RECOVERED"
  | "WAITING"
  | "CANCELED";

export type TelemetryTargetKind =
  | "VIMLA"
  | "AI_AUTO"
  | "AI_MODEL"
  | "AGENT"
  | "EVALUATOR";

export type TelemetryContextSource =
  | "IMMEDIATE"
  | "L1_RAW"
  | "L2_COMPACTED"
  | "OLDER_HISTORY"
  | "CROSS_CONVERSATION"
  | "PERSONAL_MEMORY"
  | "PROJECT_MEMORY"
  | "ENTITY"
  | "WORKSPACE_OBJECT"
  | "PROJECT_OBJECT"
  | "ARTIFACT"
  | "FILE_METADATA"
  | "DIRECT_REFERENCE"
  | "UNKNOWN";

export type TelemetryContextSelectionReason =
  | "IMMEDIATE"
  | "CURRENT_SURFACE"
  | "CURRENT_PROJECT"
  | "DIRECT_REFERENCE"
  | "AUTHORITATIVE"
  | "RELEVANT"
  | "RECENT"
  | "FALLBACK";

export type TelemetryPolicyDenialReason =
  | "ACTOR_ACCESS_DENIED"
  | "AUDIENCE_ACCESS_DENIED"
  | "TARGET_CLASSIFICATION_DENIED"
  | "INVALID_AUDIENCE"
  | "CROSS_SCOPE_BLOCKED"
  | "PACKING_EXCLUDED"
  | "OTHER";

export type TelemetryEvent =
  | {
      event: "planner.completed";
      correlationId: string;
      planId: string;
      outcome: TelemetryOutcome;
      durationMs: number;
      nodeCount: number;
      edgeCount: number;
      depth: number;
      maxParallelism: number;
      validationFailureCode?: string;
      replayed: boolean;
    }
  | {
      event: "planner.feedback";
      planId: string;
      action: "EDIT" | "RETRY" | "REPLAY";
      count: number;
    }
  | {
      event: "context.snapshot";
      planId: string;
      outcome: TelemetryOutcome;
      durationMs: number;
      itemCount: number;
      metadataBytes: number;
      sourceDistribution: Record<string, number>;
    }
  | {
      event: "context.bundle";
      planId: string;
      invocationId: string;
      targetKind: TelemetryTargetKind;
      outcome: TelemetryOutcome;
      durationMs: number;
      candidateCountBeforePolicy: number;
      candidateCountAfterPolicy: number;
      selectedItemCount: number;
      deniedItemCount: number;
      packingExcludedCount: number;
      artifactDeniedCount: number;
      budgetTokens: number;
      usedTokens: number;
      budgetUtilizationBps: number;
      rawHistoryTokens: number;
      l1RawTokens: number;
      l2CompactedTokens: number;
      sourceDistribution: Record<string, number>;
      selectionDistribution: Record<string, number>;
      denialDistribution: Record<string, number>;
    }
  | {
      event: "context.semantic_retrieval";
      planId: string;
      outcome: TelemetryOutcome;
      candidateCount: number;
      selectedCount: number;
      currentSurfaceCount: number;
      crossSurfaceCount: number;
      currentProjectCount: number;
      durationMs: number;
    }
  | {
      event: "context.memory_maintenance";
      sourceType: "MESSAGE" | "OTHER";
      outcome: TelemetryOutcome;
      durationMs: number;
      extractedCount: number;
      createdCount: number;
      supersededCount: number;
      invalidatedCount: number;
      staleCount: number;
      compactionCount: number;
      compactionInputTokens: number;
      compactionOutputTokens: number;
      compactionVersion: number | null;
    }
  | {
      event: "runtime.invocation";
      planId: string;
      invocationId: string;
      runId: string;
      targetKind: TelemetryTargetKind;
      outcome: TelemetryOutcome;
      durationMs: number;
      queueDelayMs: number;
      attempt: number;
      retryable: boolean;
      errorCode?: string;
    }
  | {
      event: "runtime.reconciliation";
      outcome: TelemetryOutcome;
      recoveredPlanningShells: number;
      recoveredInvocationRuns: number;
      recoveredStuckWorkflows: number;
      durationMs: number;
    }
  | {
      event: "economics.ai";
      planId?: string;
      invocationId?: string;
      aiRequestId: string;
      providerClass: "PAID_EXTERNAL" | "INCLUDED_LOCAL";
      modelClass: string;
      outcome: TelemetryOutcome;
      providerActualCostMicroRub: string;
      userSettledUsageMicroRub: string;
      marginMicroRub: string | null;
    }
  | {
      event: "safety.policy";
      planId?: string;
      invocationId?: string;
      action:
        | "PERMISSION_DENIED"
        | "APPROVAL_REQUIRED"
        | "APPROVAL_GRANTED"
        | "CROSS_SCOPE_BLOCKED"
        | "DUPLICATE_PREVENTED";
      reason: TelemetryPolicyDenialReason | string;
      count: number;
    }
  | {
      event: "local_ai.runtime";
      outcome: TelemetryOutcome;
      circuitState: "CLOSED" | "OPEN" | "HALF_OPEN";
      adapterActiveRequests: number;
      adapterQueuedRequests: number;
      providerActiveRequests: number | null;
      providerQueueDepth: number | null;
      gpuUtilizationPercent: number | null;
      gpuMemoryUsedBytes: number | null;
      gpuMemoryTotalBytes: number | null;
    }
  | {
      event: "rollout.gate";
      gate: string;
      enabled: boolean;
      appEnv: "local" | "test" | "staging" | "production";
    };

export interface TelemetrySink {
  emit(event: TelemetryEvent): void;
}

export const NOOP_TELEMETRY_SINK: TelemetrySink = Object.freeze({
  emit: (_event: TelemetryEvent): void => undefined,
});

export function countTelemetryValues(
  values: readonly string[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

export function telemetryDurationMs(startedAtMs: number, nowMs = Date.now()): number {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) {
    return 0;
  }
  return Math.max(0, Math.round(nowMs - startedAtMs));
}

export function telemetryRatioBps(used: number, total: number): number {
  if (
    !Number.isFinite(used) ||
    !Number.isFinite(total) ||
    used <= 0 ||
    total <= 0
  ) {
    return 0;
  }
  return Math.max(0, Math.min(10_000, Math.round((used * 10_000) / total)));
}
