import type { InvocationTarget } from "./targets.js";

export const PLANNER_MENTION_ROLES = ["EXECUTION", "EVALUATION"] as const;
export type PlannerMentionRole = (typeof PLANNER_MENTION_ROLES)[number];

export type ResolvedInvocationMentionKind = "USER" | "SYSTEM_AGENT" | "AI_AUTO" | "AI_MODEL";

export interface ResolvedInvocationMentionInput {
  id: string;
  handleId: string;
  kind: ResolvedInvocationMentionKind;
  targetId: string | null;
  canonicalHandle: string;
  startOffset: number;
  endOffset: number;
}

export type PlannerMentionTarget =
  | { kind: "VIMLA"; systemKey: "VIMLA" }
  | { kind: "AI_AUTO"; systemKey: "AI_AUTO" }
  | { kind: "AI_MODEL"; modelId: string; modelSlug: string };

export interface PlannerInvocationMention {
  occurrenceId: string;
  occurrenceIndex: number;
  handleId: string;
  canonicalHandle: string;
  startOffset: number;
  endOffset: number;
  target: PlannerMentionTarget;
  semanticRole: PlannerMentionRole | null;
}

export class PlannerMentionContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlannerMentionContractError";
  }
}

/**
 * Converts already server-validated structured mentions into the stable,
 * occurrence-level constraints consumed by the future Semantic Planner.
 *
 * USER mentions are intentionally excluded: they may be arguments/audience
 * targets for a Vimla step, but do not independently trigger AI orchestration.
 *
 * This function does not infer workflow boundaries, ordering, conditions or
 * evaluator roles from words in the message. It only freezes explicit target
 * occurrences so the Semantic Planner can reason over meaning later.
 */
export function toPlannerInvocationMentions(
  mentions: readonly ResolvedInvocationMentionInput[],
): PlannerInvocationMention[] {
  const ordered = [...mentions].sort(
    (left, right) =>
      left.startOffset - right.startOffset ||
      left.endOffset - right.endOffset ||
      left.id.localeCompare(right.id),
  );

  const seenOccurrences = new Set<string>();
  let previousEnd = -1;

  for (const mention of ordered) {
    validateResolvedMention(mention);

    if (seenOccurrences.has(mention.id)) {
      throw new PlannerMentionContractError(`Duplicate mention occurrence id: ${mention.id}`);
    }
    seenOccurrences.add(mention.id);

    if (mention.startOffset < previousEnd) {
      throw new PlannerMentionContractError("Mention ranges cannot overlap");
    }
    previousEnd = mention.endOffset;
  }

  const invocationMentions = ordered.filter(
    (mention): mention is ResolvedInvocationMentionInput & {
      kind: Exclude<ResolvedInvocationMentionKind, "USER">;
    } => mention.kind !== "USER",
  );

  return invocationMentions.map((mention, occurrenceIndex) => ({
    occurrenceId: mention.id,
    occurrenceIndex,
    handleId: mention.handleId,
    canonicalHandle: mention.canonicalHandle,
    startOffset: mention.startOffset,
    endOffset: mention.endOffset,
    target: plannerTargetFor(mention),
    semanticRole: null,
  }));
}

/**
 * Semantic role assignment is deliberately explicit. The future planner may
 * assign EVALUATION after understanding intent; this boundary must never infer
 * it from keyword matching such as "check", "if" or "approve".
 */
export function withPlannerMentionRole(
  mention: PlannerInvocationMention,
  semanticRole: PlannerMentionRole,
): PlannerInvocationMention {
  return {
    ...mention,
    semanticRole,
  };
}

/**
 * Converts a planner-resolved mention target to the existing immutable
 * ExecutionPlan InvocationTarget contract. Stable model identity remains on
 * PlannerMentionTarget for provenance while orchestration continues to use the
 * public model slug until PR-09 performs authoritative catalog resolution.
 */
export function invocationTargetForPlannerMention(
  mention: Pick<PlannerInvocationMention, "target">,
): InvocationTarget {
  switch (mention.target.kind) {
    case "VIMLA":
      return { kind: "VIMLA" };
    case "AI_AUTO":
      return { kind: "AI_AUTO" };
    case "AI_MODEL":
      return { kind: "AI_MODEL", modelSlug: mention.target.modelSlug };
  }
}

function plannerTargetFor(
  mention: ResolvedInvocationMentionInput & {
    kind: Exclude<ResolvedInvocationMentionKind, "USER">;
  },
): PlannerMentionTarget {
  switch (mention.kind) {
    case "SYSTEM_AGENT":
      if (
        mention.targetId !== "VIMLA" ||
        mention.canonicalHandle !== "vimla"
      ) {
        throw new PlannerMentionContractError(
          "SYSTEM_AGENT planner mention must resolve to @vimla / VIMLA",
        );
      }
      return { kind: "VIMLA", systemKey: "VIMLA" };

    case "AI_AUTO":
      if (
        mention.targetId !== "AI_AUTO" ||
        mention.canonicalHandle !== "auto"
      ) {
        throw new PlannerMentionContractError(
          "AI_AUTO planner mention must resolve to @auto / AI_AUTO",
        );
      }
      return { kind: "AI_AUTO", systemKey: "AI_AUTO" };

    case "AI_MODEL":
      if (!mention.targetId) {
        throw new PlannerMentionContractError(
          "AI_MODEL planner mention requires a stable model target id",
        );
      }
      return {
        kind: "AI_MODEL",
        modelId: mention.targetId,
        modelSlug: mention.canonicalHandle,
      };
  }
}

function validateResolvedMention(mention: ResolvedInvocationMentionInput): void {
  if (mention.id.trim().length === 0) {
    throw new PlannerMentionContractError("Mention occurrence id is required");
  }
  if (mention.handleId.trim().length === 0) {
    throw new PlannerMentionContractError("Mention handle id is required");
  }
  if (mention.canonicalHandle.trim().length === 0) {
    throw new PlannerMentionContractError("Canonical handle is required");
  }
  if (
    !Number.isInteger(mention.startOffset) ||
    !Number.isInteger(mention.endOffset) ||
    mention.startOffset < 0 ||
    mention.endOffset <= mention.startOffset
  ) {
    throw new PlannerMentionContractError("Mention range is invalid");
  }
}
