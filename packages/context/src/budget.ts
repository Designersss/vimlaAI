import type { PrismaClient } from "@vimla/database";
import type { ContextInvocationTargetKind } from "./policy.js";

export const CONTEXT_PACKING_VERSION = 1 as const;

export interface ContextBudget {
  contextWindowTokens: number;
  outputReserveTokens: number;
  systemToolReserveTokens: number;
  artifactReserveTokens: number;
  safetyMarginTokens: number;
  effectiveHistoryBudgetTokens: number;
  compactedStateTriggerTokens: number;
}

export interface ResolveContextBudgetInput {
  targetKind: ContextInvocationTargetKind;
  targetModelSlug: string | null;
}

export interface ContextBudgetDefaults {
  internalContextWindowTokens?: number;
  internalOutputReserveTokens?: number;
  externalFallbackContextWindowTokens?: number;
  externalFallbackOutputReserveTokens?: number;
  systemToolReserveTokens?: number;
  artifactReserveTokens?: number;
  safetyMarginRatio?: number;
  compactedStateUtilizationRatio?: number;
}

const DEFAULT_INTERNAL_CONTEXT_WINDOW = 32_768;
const DEFAULT_INTERNAL_OUTPUT_RESERVE = 4_096;
const DEFAULT_EXTERNAL_CONTEXT_WINDOW = 16_384;
const DEFAULT_EXTERNAL_OUTPUT_RESERVE = 4_096;
const DEFAULT_SYSTEM_TOOL_RESERVE = 2_048;
const DEFAULT_ARTIFACT_RESERVE = 4_096;
const DEFAULT_SAFETY_MARGIN_RATIO = 0.08;
const DEFAULT_COMPACTED_STATE_UTILIZATION_RATIO = 0.8;

export class ContextBudgetService {
  constructor(
    private readonly db: PrismaClient,
    private readonly defaults: ContextBudgetDefaults = {},
  ) {}

  async resolve(input: ResolveContextBudgetInput): Promise<ContextBudget> {
    const model = await this.resolveModelBudget(input);
    const contextWindowTokens =
      model?.contextWindowTokens ??
      (isExternalTarget(input.targetKind)
        ? this.defaults.externalFallbackContextWindowTokens ??
          DEFAULT_EXTERNAL_CONTEXT_WINDOW
        : this.defaults.internalContextWindowTokens ??
          DEFAULT_INTERNAL_CONTEXT_WINDOW);
    const outputReserveTokens =
      model?.maxOutputTokens ??
      (isExternalTarget(input.targetKind)
        ? this.defaults.externalFallbackOutputReserveTokens ??
          DEFAULT_EXTERNAL_OUTPUT_RESERVE
        : this.defaults.internalOutputReserveTokens ??
          DEFAULT_INTERNAL_OUTPUT_RESERVE);
    const systemToolReserveTokens =
      this.defaults.systemToolReserveTokens ?? DEFAULT_SYSTEM_TOOL_RESERVE;
    const artifactReserveTokens =
      this.defaults.artifactReserveTokens ?? DEFAULT_ARTIFACT_RESERVE;
    const safetyMarginRatio =
      this.defaults.safetyMarginRatio ?? DEFAULT_SAFETY_MARGIN_RATIO;
    const safetyMarginTokens = Math.max(
      1_024,
      Math.floor(contextWindowTokens * safetyMarginRatio),
    );

    const effectiveHistoryBudgetTokens = Math.max(
      512,
      contextWindowTokens -
        outputReserveTokens -
        systemToolReserveTokens -
        artifactReserveTokens -
        safetyMarginTokens,
    );
    const compactedStateUtilizationRatio =
      this.defaults.compactedStateUtilizationRatio ??
      DEFAULT_COMPACTED_STATE_UTILIZATION_RATIO;
    const compactedStateTriggerTokens = Math.max(
      1,
      Math.floor(
        effectiveHistoryBudgetTokens * compactedStateUtilizationRatio,
      ),
    );

    return {
      contextWindowTokens,
      outputReserveTokens,
      systemToolReserveTokens,
      artifactReserveTokens,
      safetyMarginTokens,
      effectiveHistoryBudgetTokens,
      compactedStateTriggerTokens,
    };
  }

  private async resolveModelBudget(
    input: ResolveContextBudgetInput,
  ): Promise<{ contextWindowTokens: number; maxOutputTokens: number } | null> {
    if (input.targetKind === "AI_MODEL" && input.targetModelSlug) {
      return this.db.aiModel.findUnique({
        where: { slug: input.targetModelSlug },
        select: {
          contextWindowTokens: true,
          maxOutputTokens: true,
        },
      });
    }

    if (input.targetKind === "AI_AUTO") {
      const candidates = await this.db.aiModel.findMany({
        where: {
          active: true,
          visible: true,
        },
        select: {
          contextWindowTokens: true,
          maxOutputTokens: true,
        },
        orderBy: [
          { contextWindowTokens: "asc" },
          { maxOutputTokens: "desc" },
        ],
        take: 1,
      });
      return candidates[0] ?? null;
    }

    return null;
  }
}

export function shouldUseCompactedState(
  rawHistoryTokens: number,
  budget: ContextBudget,
): boolean {
  return rawHistoryTokens >= budget.compactedStateTriggerTokens;
}

function isExternalTarget(targetKind: ContextInvocationTargetKind): boolean {
  return (
    targetKind === "AI_AUTO" ||
    targetKind === "AI_MODEL" ||
    targetKind === "AGENT"
  );
}
