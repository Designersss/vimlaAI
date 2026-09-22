import type { ContextClassification } from "./types.js";

export const CONTEXT_POLICY_VERSION = 1 as const;

export type ContextAudienceKind = "PERSONAL" | "PROJECT" | "DIRECT_CHAT";
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

export type ContextSurfaceDescriptor =
  | { kind: "PERSONAL"; ownerUserId: string }
  | { kind: "PROJECT"; projectId: string }
  | { kind: "DIRECT_CHAT"; directConversationId: string };

export interface ContextAudienceDescriptor {
  kind: ContextAudienceKind;
  participantUserIds: readonly string[];
  projectId?: string;
  directConversationId?: string;
}

export type ContextPolicyDenialReason =
  | "SOURCE_SCOPE_DENIED"
  | "TARGET_CLASSIFICATION_DENIED"
  | "ACTOR_ACCESS_DENIED"
  | "AUDIENCE_ACCESS_DENIED";

export type ContextPolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: ContextPolicyDenialReason };

export interface EvaluateContextPolicyInput {
  actorUserId: string;
  surface: ContextSurfaceDescriptor;
  targetKind: ContextInvocationTargetKind;
  classification: ContextClassification;
  sourceScope: ContextSourceScope;
  actorHasAccess: boolean;
  audienceHasAccess: boolean;
}

export function evaluateContextPolicy(
  input: EvaluateContextPolicyInput,
): ContextPolicyDecision {
  if (!sourceScopeAllowed(input.surface, input.sourceScope, input.actorUserId)) {
    return { allowed: false, reason: "SOURCE_SCOPE_DENIED" };
  }

  if (
    input.classification === "RESTRICTED" &&
    isExternalTarget(input.targetKind)
  ) {
    return { allowed: false, reason: "TARGET_CLASSIFICATION_DENIED" };
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
  actorUserId: string;
  surface: ContextSurfaceDescriptor;
  requestedScope: ContextSourceScope;
  explicitAction: boolean;
  actorHasWriteAccess: boolean;
}

export function evaluateContextWritePolicy(
  input: EvaluateContextWritePolicyInput,
): ContextWriteDecision {
  if (!input.actorHasWriteAccess) {
    return { allowed: false, reason: "WRITE_ACCESS_DENIED" };
  }

  if (
    input.surface.kind === "PERSONAL" &&
    input.requestedScope.kind === "PERSONAL" &&
    input.surface.ownerUserId === input.actorUserId &&
    input.requestedScope.ownerUserId === input.actorUserId
  ) {
    return { allowed: true };
  }

  if (
    input.surface.kind === "PERSONAL" &&
    input.requestedScope.kind === "PROJECT"
  ) {
    return input.explicitAction
      ? { allowed: true }
      : {
          allowed: false,
          reason: "CROSS_SCOPE_WRITE_REQUIRES_EXPLICIT_ACTION",
        };
  }

  if (
    input.surface.kind === "PROJECT" &&
    input.requestedScope.kind === "PROJECT" &&
    input.surface.projectId === input.requestedScope.projectId
  ) {
    return input.explicitAction
      ? { allowed: true }
      : {
          allowed: false,
          reason: "CROSS_SCOPE_WRITE_REQUIRES_EXPLICIT_ACTION",
        };
  }

  if (
    input.surface.kind === "DIRECT_CHAT" &&
    input.requestedScope.kind === "DIRECT_CHAT" &&
    input.surface.directConversationId ===
      input.requestedScope.directConversationId
  ) {
    return { allowed: true };
  }

  return { allowed: false, reason: "WRITE_SCOPE_DENIED" };
}

export function surfaceFromAudience(
  actorUserId: string,
  audience: ContextAudienceDescriptor,
): ContextSurfaceDescriptor {
  switch (audience.kind) {
    case "PERSONAL":
      return { kind: "PERSONAL", ownerUserId: actorUserId };
    case "PROJECT":
      if (!audience.projectId) {
        throw new TypeError("Project audience requires projectId");
      }
      return { kind: "PROJECT", projectId: audience.projectId };
    case "DIRECT_CHAT":
      if (!audience.directConversationId) {
        throw new TypeError("Direct-chat audience requires directConversationId");
      }
      return {
        kind: "DIRECT_CHAT",
        directConversationId: audience.directConversationId,
      };
  }
}

function sourceScopeAllowed(
  surface: ContextSurfaceDescriptor,
  source: ContextSourceScope,
  actorUserId: string,
): boolean {
  switch (surface.kind) {
    case "PERSONAL":
      if (source.kind === "PERSONAL") {
        return (
          surface.ownerUserId === actorUserId &&
          source.ownerUserId === actorUserId
        );
      }
      return source.kind === "PROJECT";

    case "PROJECT":
      return (
        source.kind === "PROJECT" &&
        source.projectId === surface.projectId
      );

    case "DIRECT_CHAT":
      if (source.kind === "DIRECT_CHAT") {
        return source.directConversationId === surface.directConversationId;
      }
      return source.kind === "PROJECT";
  }
}

function isExternalTarget(target: ContextInvocationTargetKind): boolean {
  return target === "AI_AUTO" || target === "AI_MODEL" || target === "AGENT";
}
