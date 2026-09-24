import {
  ContextAccessDeniedError,
  ContextBundleService,
  ContextError,
  type ContextBundleView,
} from "@vimla/context";
import type { PrismaClient } from "@vimla/database";
import {
  NOOP_TELEMETRY_SINK,
  countTelemetryValues,
  telemetryDurationMs,
  telemetryRatioBps,
  type TelemetrySink,
} from "@vimla/shared";
import type {
  InvocationExecutionInput,
  InvocationExecutionResult,
  InvocationExecutorRegistry,
} from "./orchestration.js";

export class ContextAwareInvocationExecutorRegistry
  implements InvocationExecutorRegistry
{
  private readonly bundles: ContextBundleService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly fallback: InvocationExecutorRegistry,
    bundles?: ContextBundleService,
    private readonly enabled = true,
    private readonly telemetry: TelemetrySink = NOOP_TELEMETRY_SINK,
  ) {
    this.bundles = bundles ?? new ContextBundleService(prisma);
  }

  async execute(
    input: InvocationExecutionInput,
  ): Promise<InvocationExecutionResult> {
    const startedAt = Date.now();
    if (!this.enabled) {
      return terminal("CONTEXT_RETRIEVAL_DISABLED");
    }

    const invocation = await this.prisma.invocation.findFirst({
      where: {
        id: input.invocationId,
        planId: input.planId,
      },
      select: {
        targetKind: true,
        targetModelSlug: true,
        targetAgentId: true,
        plan: {
          select: {
            userId: true,
          },
        },
      },
    });
    if (!invocation) {
      return terminal("CONTEXT_POLICY_INVOCATION_NOT_FOUND");
    }
    if (!persistedTargetMatches(invocation, input.target)) {
      this.telemetry.emit({
        event: "safety.policy",
        planId: input.planId,
        invocationId: input.invocationId,
        action: "PERMISSION_DENIED",
        reason: "OTHER",
        count: 1,
      });
      return terminal("CONTEXT_POLICY_TARGET_MISMATCH");
    }

    let bundle: ContextBundleView;
    try {
      bundle = await this.bundles.resolveForInvocation({
        actorUserId: invocation.plan.userId,
        invocationId: input.invocationId,
      });
      if (
        input.target.kind === "VIMLA" &&
        bundle.manifest.surfaceKind !== "PERSONAL"
      ) {
        this.telemetry.emit({
          event: "safety.policy",
          planId: input.planId,
          invocationId: input.invocationId,
          action: "CROSS_SCOPE_BLOCKED",
          reason: "CROSS_SCOPE_BLOCKED",
          count: 1,
        });
        return terminal("CONTEXT_POLICY_EXECUTOR_SURFACE_UNSUPPORTED");
      }
    } catch (error: unknown) {
      if (error instanceof ContextAccessDeniedError) {
        this.telemetry.emit({
          event: "safety.policy",
          planId: input.planId,
          invocationId: input.invocationId,
          action: "PERMISSION_DENIED",
          reason: "ACTOR_ACCESS_DENIED",
          count: 1,
        });
        return terminal("CONTEXT_POLICY_DENIED");
      }
      if (error instanceof ContextError) {
        return terminal("CONTEXT_POLICY_INVALID");
      }
      throw error;
    }

    const manifest = bundle.manifest;
    const afterPolicyCount =
      manifest.allowedItems.length + manifest.packingExclusions.length;
    this.telemetry.emit({
      event: "context.bundle",
      planId: input.planId,
      invocationId: input.invocationId,
      targetKind: input.target.kind,
      outcome: "SUCCESS",
      durationMs: telemetryDurationMs(startedAt),
      candidateCountBeforePolicy:
        afterPolicyCount + manifest.denials.length,
      candidateCountAfterPolicy: afterPolicyCount,
      selectedItemCount: manifest.allowedItems.length,
      deniedItemCount: manifest.denials.length,
      packingExcludedCount: manifest.packingExclusions.length,
      artifactDeniedCount: manifest.artifactDenials.length,
      budgetTokens: manifest.budget.effectiveHistoryBudgetTokens,
      usedTokens: manifest.usedTokens,
      budgetUtilizationBps: telemetryRatioBps(
        manifest.usedTokens,
        manifest.budget.effectiveHistoryBudgetTokens,
      ),
      rawHistoryTokens: manifest.rawHistoryTokens,
      l1RawTokens: manifest.rawHistoryTokens,
      l2CompactedTokens: manifest.allowedItems
        .filter((item) => item.sourceType === "COMPACTED_STATE")
        .reduce((total, item) => total + item.estimatedTokens, 0),
      sourceDistribution: countTelemetryValues(
        manifest.allowedItems.map((item) => item.sourceType),
      ),
      selectionDistribution: countTelemetryValues(
        manifest.allowedItems.map((item) => item.selectionReason),
      ),
      denialDistribution: countTelemetryValues([
        ...manifest.denials.map((denial) => denial.reason),
        ...manifest.packingExclusions.map(
          (exclusion) => `PACKING_${exclusion.reason}`,
        ),
        ...manifest.artifactDenials.map((denial) => denial.reason),
      ]),
    });

    return this.fallback.execute({
      ...input,
      contextBundle: bundle,
    });
  }
}

function persistedTargetMatches(
  invocation: {
    targetKind: string;
    targetModelSlug: string | null;
    targetAgentId: string | null;
  },
  target: InvocationExecutionInput["target"],
): boolean {
  return (
    invocation.targetKind === target.kind &&
    invocation.targetModelSlug === target.modelSlug &&
    invocation.targetAgentId === target.agentId
  );
}

function terminal(errorCode: string): InvocationExecutionResult {
  return {
    status: "FAILED",
    errorCode,
    retryable: false,
  };
}
