export const INVOCATION_TARGET_KINDS = ["VIMLA", "AI_AUTO", "AI_MODEL", "EVALUATOR", "AGENT"] as const;

export type InvocationTargetKind = (typeof INVOCATION_TARGET_KINDS)[number];

export type InvocationTarget =
  | { kind: "VIMLA" }
  | { kind: "AI_AUTO" }
  | { kind: "AI_MODEL"; modelSlug: string }
  | { kind: "EVALUATOR" }
  | { kind: "AGENT"; agentId: string };

export function isExplicitAiModelTarget(target: InvocationTarget): target is Extract<InvocationTarget, { kind: "AI_MODEL" }> {
  return target.kind === "AI_MODEL";
}

export function isAgentTarget(target: InvocationTarget): target is Extract<InvocationTarget, { kind: "AGENT" }> {
  return target.kind === "AGENT";
}
