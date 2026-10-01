import type { ContextClassification } from "./types.js";

export const CONTEXT_POLICY_VERSION = 2 as const;

export type ContextInvocationTargetKind =
  | "VIMLA"
  | "AI_AUTO"
  | "AI_MODEL"
  | "AGENT"
  | "EVALUATOR";

export type ContextSourceScope =
  | { kind: "PERSONAL"; ownerUserId: string }
  | { kind: "PROJECT"; projectId: string }
  | { kind: "DIRECT_CHAT"; directConversationId: string };

export type ContextReadScope = ContextSourceScope;
export type ContextWriteScope = ContextSourceScope;

export type ContextPolicyDenialReason =
  | "SOURCE_SCOPE_DENIED"
  | "TARGET_CLASSIFICATION_DENIED"
  | "ACTOR_ACCESS_DENIED"
  | "AUDIENCE_ACCESS_DENIED";

export type ContextPolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: ContextPolicyDenialReason };

export interface EvaluateContextPolicyInput {
  targetKind: ContextInvocationTargetKind;
  classification: ContextClassification;
  sourceScopeEligible: boolean;
  actorHasAccess: boolean;
  audienceHasAccess: boolean;
}

export function evaluateContextPolicy(
  input: EvaluateContextPolicyInput,
): ContextPolicyDecision {
  if (!input.sourceScopeEligible) {
    return { allowed: false, reason: "SOURCE_SCOPE_DENIED" };
  }

  if (
    !isInvocationTargetClassificationAllowed(
      input.targetKind,
      input.classification,
    )
  ) {
    return {
      allowed: false,
      reason: "TARGET_CLASSIFICATION_DENIED",
    };
  }

  if (!input.actorHasAccess) {
    return { allowed: false, reason: "ACTOR_ACCESS_DENIED" };
  }

  if (!input.audienceHasAccess) {
    return { allowed: false, reason: "AUDIENCE_ACCESS_DENIED" };
  }

  return { allowed: true };
}

export type ContextWriteDenialReason =
  | "WRITE_SCOPE_DENIED"
  | "CROSS_SCOPE_WRITE_REQUIRES_EXPLICIT_ACTION"
  | "WRITE_ACCESS_DENIED";

export type ContextWriteDecision =
  | { allowed: true }
  | { allowed: false; reason: ContextWriteDenialReason };

export interface EvaluateContextWritePolicyInput {
  scopeEligible: boolean;
  explicitActionRequired: boolean;
  explicitAction: boolean;
  actorHasWriteAccess: boolean;
}

export function evaluateContextWritePolicy(
  input: EvaluateContextWritePolicyInput,
): ContextWriteDecision {
  if (!input.actorHasWriteAccess) {
    return { allowed: false, reason: "WRITE_ACCESS_DENIED" };
  }
  if (!input.scopeEligible) {
    return { allowed: false, reason: "WRITE_SCOPE_DENIED" };
  }
  if (
    input.explicitActionRequired &&
    !input.explicitAction
  ) {
    return {
      allowed: false,
      reason: "CROSS_SCOPE_WRITE_REQUIRES_EXPLICIT_ACTION",
    };
  }
  return { allowed: true };
}

export function isKnownContextClassification(
  classification: string,
): classification is ContextClassification {
  return (
    classification === "PUBLIC" ||
    classification === "INTERNAL" ||
    classification === "PRIVATE" ||
    classification === "RESTRICTED"
  );
}

export function isInvocationTargetClassificationAllowed(
  target: ContextInvocationTargetKind,
  classification: string,
): classification is ContextClassification {
  if (!isKnownContextClassification(classification)) {
    return false;
  }
  return (
    !isExternalTarget(target) ||
    classification !== "RESTRICTED"
  );
}

export function isExternalProviderClassificationAllowed(
  classification: string,
): boolean {
  return isInvocationTargetClassificationAllowed(
    "AI_MODEL",
    classification,
  );
}

function isExternalTarget(
  target: ContextInvocationTargetKind,
): boolean {
  return (
    target === "AI_AUTO" ||
    target === "AI_MODEL" ||
    target === "AGENT"
  );
}
